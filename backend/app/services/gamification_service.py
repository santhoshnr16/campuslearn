"""
Gamification service for XP, streaks, hearts, mastery, and adaptive learning.
"""

from datetime import datetime, date, timedelta, timezone
from typing import Optional, List, Tuple
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, update
from sqlalchemy.orm import selectinload

from app.models.user import User
from app.models.gamification import Enrollment, StudentProgress, TestHistory, DailyActivity
from app.models.subject import Subject, Topic
from app.models.question import Question
from app.core.logging import logger


# XP Constants
XP_EASY = 10
XP_MEDIUM = 20
XP_HARD = 40
XP_PERFECT_BONUS = 15
XP_STREAK_MULTIPLIER = 0.1  # 10% bonus per streak day (capped at 50%)
XP_FIRST_ATTEMPT_BONUS = 5
XP_PRACTICE_MULTIPLIER = 0.5

# Hearts
MAX_HEARTS = 5
HEART_REGEN_MINUTES = 30

# Mastery
MASTERY_CORRECT_GAIN = 5.0
MASTERY_WRONG_LOSS = 3.0
MASTERY_FAST_BONUS = 2.0  # < 10 seconds
MASTERY_MAX = 100.0

# Levels
XP_PER_LEVEL = 100

# Adaptive difficulty thresholds (accuracy %)
DIFFICULTY_EASY_THRESHOLD = 60
DIFFICULTY_HARD_THRESHOLD = 85


def calculate_xp(difficulty: str, streak_count: int, is_correct: bool, is_first_attempt: bool = True, is_practice: bool = False) -> int:
    """Calculate XP for a single answer."""
    if not is_correct:
        return 0
    
    base_xp = {"easy": XP_EASY, "medium": XP_MEDIUM, "hard": XP_HARD}.get(difficulty, XP_EASY)
    
    # Streak multiplier (capped at 50%)
    streak_mult = 1.0 + min(streak_count * XP_STREAK_MULTIPLIER, 0.5)
    
    xp = int(base_xp * streak_mult)
    
    if is_first_attempt:
        xp += XP_FIRST_ATTEMPT_BONUS
    
    if is_practice:
        xp = int(xp * XP_PRACTICE_MULTIPLIER)
    
    return xp


def calculate_level(xp_total: int) -> int:
    """Calculate level from total XP."""
    return max(1, (xp_total // XP_PER_LEVEL) + 1)


def get_badges(streak_count: int) -> List[str]:
    """Get earned badges based on streak."""
    badges = []
    if streak_count >= 7:
        badges.append("streak_bronze")
    if streak_count >= 30:
        badges.append("streak_silver")
    if streak_count >= 100:
        badges.append("streak_gold")
    return badges


async def generate_tutor_feedback(
    question_details: list, correct_count: int, total_questions: int
) -> Optional[str]:
    """Generate personalized AI tutor feedback using the LLM service.
    
    Args:
        question_details: List of dicts with question_text, options, selected_answer, correct_answer, is_correct
        correct_count: Number of correct answers
        total_questions: Total number of questions
    
    Returns:
        Tutor feedback string or None if LLM is unavailable
    """
    try:
        from app.services.llm_service import LLMService
        llm = LLMService()
        
        # Build the question summary for the prompt
        q_summary_parts = []
        for i, q in enumerate(question_details, 1):
            status = "✅ Correct" if q["is_correct"] else "❌ Incorrect"
            q_summary_parts.append(
                f"Q{i}: {q['question_text']}\n"
                f"  Student's answer: {q['selected_answer']}\n"
                f"  Correct answer: {q['correct_answer']}\n"
                f"  Result: {status}"
            )
        q_summary = "\n\n".join(q_summary_parts)
        
        system_prompt = (
            "You are a warm, encouraging AI tutor for a college learning platform. "
            "After a student completes a quiz, you give a brief personalized summary. "
            "Praise specific correct concepts. For missed questions, gently explain the right answer. "
            "Keep your response concise (3-6 sentences), conversational, and motivating. "
            "Do not use markdown headers. Use plain text with occasional emojis."
        )
        
        prompt = (
            f"A student just scored {correct_count}/{total_questions} on a quiz.\n\n"
            f"Here are the details:\n\n{q_summary}\n\n"
            f"Give a short, personalized tutor response."
        )
        
        feedback = await llm.generate_with_fallback(
            prompt=prompt,
            system_prompt=system_prompt,
            temperature=0.7,
            max_tokens=500,
            fallback_response=None,
        )
        return feedback.strip() if feedback else None
    except Exception as e:
        logger.warning(f"Tutor feedback generation failed: {e}")
        return None


class GamificationService:
    """Service handling all gamification logic."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # --- Enrollment ---

    async def enroll_student(self, student_id: UUID, subject_id: UUID) -> Enrollment:
        """Request enrollment in a subject (creates a pending enrollment)."""
        existing = await self.db.execute(
            select(Enrollment).where(
                and_(Enrollment.student_id == student_id, Enrollment.subject_id == subject_id)
            )
        )
        existing_enrollment = existing.scalar_one_or_none()
        if existing_enrollment:
            if existing_enrollment.status == "rejected":
                # Allow re-requesting after rejection
                existing_enrollment.status = "pending"
                existing_enrollment.reviewed_at = None
                await self.db.commit()
                await self.db.refresh(existing_enrollment)
                return existing_enrollment
            raise ValueError("Already enrolled or enrollment pending for this subject")
        
        enrollment = Enrollment(
            student_id=student_id,
            subject_id=subject_id,
            status="pending",
            is_active=False,
        )
        self.db.add(enrollment)
        await self.db.commit()
        await self.db.refresh(enrollment)
        return enrollment

    async def get_enrollments(self, student_id: UUID) -> List[dict]:
        """Get all approved enrollments for a student."""
        result = await self.db.execute(
            select(Enrollment, Subject)
            .join(Subject, Enrollment.subject_id == Subject.id)
            .where(
                and_(
                    Enrollment.student_id == student_id,
                    Enrollment.status == "approved",
                    Enrollment.is_active == True,
                )
            )
        )
        rows = result.all()
        return [
            {
                "id": e.id,
                "student_id": e.student_id,
                "subject_id": e.subject_id,
                "enrolled_at": e.enrolled_at,
                "is_active": e.is_active,
                "status": e.status,
                "subject_name": s.name,
                "subject_code": s.code,
            }
            for e, s in rows
        ]

    async def get_all_enrollments(self, student_id: UUID) -> List[dict]:
        """Get all enrollments for a student (including pending/rejected)."""
        result = await self.db.execute(
            select(Enrollment, Subject)
            .join(Subject, Enrollment.subject_id == Subject.id)
            .where(Enrollment.student_id == student_id)
            .order_by(Enrollment.enrolled_at.desc())
        )
        rows = result.all()
        return [
            {
                "id": e.id,
                "student_id": e.student_id,
                "subject_id": e.subject_id,
                "enrolled_at": e.enrolled_at,
                "is_active": e.is_active,
                "status": e.status,
                "subject_name": s.name,
                "subject_code": s.code,
            }
            for e, s in rows
        ]

    async def get_pending_enrollments(self, teacher_id: UUID, subject_id: Optional[UUID] = None) -> List[dict]:
        """Get pending enrollment requests for a teacher's subjects."""
        query = (
            select(Enrollment, User.full_name, User.email, Subject.name)
            .join(Subject, Enrollment.subject_id == Subject.id)
            .join(User, Enrollment.student_id == User.id)
            .where(
                and_(
                    Subject.user_id == teacher_id,
                    Enrollment.status == "pending",
                )
            )
        )
        if subject_id:
            query = query.where(Enrollment.subject_id == subject_id)
        query = query.order_by(Enrollment.enrolled_at.asc())

        result = await self.db.execute(query)
        rows = result.all()
        return [
            {
                "id": e.id,
                "student_id": e.student_id,
                "student_name": full_name or "Unknown",
                "student_email": email,
                "subject_id": e.subject_id,
                "subject_name": subj_name,
                "enrolled_at": e.enrolled_at,
                "status": e.status,
            }
            for e, full_name, email, subj_name in rows
        ]

    async def approve_enrollment(self, enrollment_id: UUID, teacher_id: UUID) -> Enrollment:
        """Approve a pending enrollment request."""
        result = await self.db.execute(
            select(Enrollment)
            .join(Subject, Enrollment.subject_id == Subject.id)
            .where(
                and_(
                    Enrollment.id == enrollment_id,
                    Subject.user_id == teacher_id,
                )
            )
        )
        enrollment = result.scalar_one_or_none()
        if not enrollment:
            raise ValueError("Enrollment not found or unauthorized")
        if enrollment.status != "pending":
            raise ValueError(f"Enrollment is already {enrollment.status}")
        
        enrollment.status = "approved"
        enrollment.is_active = True
        enrollment.reviewed_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(enrollment)
        logger.info(f"Enrollment {enrollment_id} approved by teacher {teacher_id}")
        return enrollment

    async def reject_enrollment(self, enrollment_id: UUID, teacher_id: UUID) -> Enrollment:
        """Reject a pending enrollment request."""
        result = await self.db.execute(
            select(Enrollment)
            .join(Subject, Enrollment.subject_id == Subject.id)
            .where(
                and_(
                    Enrollment.id == enrollment_id,
                    Subject.user_id == teacher_id,
                )
            )
        )
        enrollment = result.scalar_one_or_none()
        if not enrollment:
            raise ValueError("Enrollment not found or unauthorized")
        # Allow rejecting pending requests OR revoking already-approved enrollments
        if enrollment.status not in ("pending", "approved"):
            raise ValueError(f"Cannot reject/revoke enrollment with status '{enrollment.status}'")
        
        action = "revoked" if enrollment.status == "approved" else "rejected"
        enrollment.status = "rejected"
        enrollment.is_active = False
        enrollment.reviewed_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(enrollment)
        logger.info(f"Enrollment {enrollment_id} {action} by teacher {teacher_id}")
        return enrollment

    # --- Available Subjects ---

    async def get_available_subjects(self, student_id: UUID) -> List[dict]:
        """Get all published subjects with enrollment status."""
        result = await self.db.execute(
            select(Subject, User.full_name, User.username)
            .join(User, Subject.user_id == User.id)
            .where(Subject.published == True)
        )
        subjects = result.all()
        
        # Get enrollment status per subject
        enroll_result = await self.db.execute(
            select(Enrollment.subject_id, Enrollment.status).where(
                Enrollment.student_id == student_id
            )
        )
        enrollment_map = {row[0]: row[1] for row in enroll_result.all()}
        
        # Get progress per subject
        progress_result = await self.db.execute(
            select(
                StudentProgress.subject_id,
                func.avg(StudentProgress.topic_mastery).label("avg_mastery"),
                func.sum(StudentProgress.xp_earned).label("total_xp"),
            )
            .where(StudentProgress.student_id == student_id)
            .group_by(StudentProgress.subject_id)
        )
        progress_map = {row[0]: {"mastery": float(row[1] or 0), "xp": int(row[2] or 0)} for row in progress_result.all()}
        
        return [
            {
                "id": s.id,
                "name": s.name,
                "code": s.code,
                "description": s.description,
                "teacher_name": full_name or username,
                "total_topics": s.total_topics,
                "total_questions": s.total_questions,
                "is_enrolled": enrollment_map.get(s.id) == "approved",
                "enrollment_status": enrollment_map.get(s.id),
                "mastery": progress_map.get(s.id, {}).get("mastery", 0.0),
                "xp_earned": progress_map.get(s.id, {}).get("xp", 0),
            }
            for s, full_name, username in subjects
        ]

    # --- Hearts ---

    async def get_hearts(self, student_id: UUID) -> int:
        """Get current hearts, regenerating if time has passed."""
        user = await self.db.get(User, student_id)
        if not user:
            return MAX_HEARTS
        
        if user.hearts < MAX_HEARTS and user.hearts_updated_at:
            last_updated = user.hearts_updated_at
            if last_updated.tzinfo is None:
                last_updated = last_updated.replace(tzinfo=timezone.utc)
            elapsed = datetime.now(timezone.utc) - last_updated
            regen = int(elapsed.total_seconds() // (HEART_REGEN_MINUTES * 60))
            if regen > 0:
                user.hearts = min(MAX_HEARTS, user.hearts + regen)
                user.hearts_updated_at = datetime.now(timezone.utc)
                await self.db.commit()
        
        return user.hearts

    async def use_heart(self, student_id: UUID) -> int:
        """Consume one heart. Returns remaining hearts."""
        user = await self.db.get(User, student_id)
        if not user:
            return 0
        
        # Regenerate first
        await self.get_hearts(student_id)
        await self.db.refresh(user)
        
        if user.hearts <= 0:
            return 0
        
        user.hearts -= 1
        user.hearts_updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        return user.hearts

    # --- Streaks ---

    async def update_streak(self, student_id: UUID) -> Tuple[int, bool]:
        """Update streak based on daily activity. Returns (new_streak, maintained)."""
        user = await self.db.get(User, student_id)
        if not user:
            return (0, False)
        
        today = date.today()
        
        if user.last_active_date:
            last_active = user.last_active_date
            if hasattr(last_active, 'date'):
                last_active = last_active.date()
            
            if last_active == today:
                return (user.streak_count, True)
            elif last_active == today - timedelta(days=1):
                user.streak_count += 1
            else:
                user.streak_count = 1
        else:
            user.streak_count = 1
        
        user.last_active_date = datetime.now(timezone.utc)
        await self.db.commit()
        return (user.streak_count, True)

    # --- Lesson Fetching ---

    async def get_lesson_questions(
        self, student_id: UUID, subject_id: UUID, topic_id: Optional[UUID] = None, count: int = 10
    ) -> dict:
        """Get lesson questions with adaptive difficulty."""
        # Get current difficulty for student
        difficulty = "easy"
        if topic_id:
            progress = await self.db.execute(
                select(StudentProgress).where(
                    and_(
                        StudentProgress.student_id == student_id,
                        StudentProgress.subject_id == subject_id,
                        StudentProgress.topic_id == topic_id,
                    )
                )
            )
            p = progress.scalar_one_or_none()
            if p:
                difficulty = p.current_difficulty
        
        # Build query for approved questions
        q = select(Question).where(
            and_(
                Question.subject_id == subject_id,
                Question.vetting_status == "approved",
                Question.is_archived == False,
                Question.is_latest == True,
            )
        )
        if topic_id:
            q = q.where(Question.topic_id == topic_id)
        
        q = q.where(Question.difficulty_level == difficulty)
        q = q.order_by(func.random()).limit(count)
        
        result = await self.db.execute(q)
        questions = result.scalars().all()
        
        # If not enough questions at current difficulty, fill with others
        if len(questions) < count:
            existing_ids = [qq.id for qq in questions]
            fill_q = select(Question).where(
                and_(
                    Question.subject_id == subject_id,
                    Question.vetting_status == "approved",
                    Question.is_archived == False,
                    Question.is_latest == True,
                )
            )
            if existing_ids:
                fill_q = fill_q.where(Question.id.notin_(existing_ids))
            if topic_id:
                fill_q = fill_q.where(Question.topic_id == topic_id)
            fill_q = fill_q.order_by(func.random()).limit(count - len(questions))
            fill_result = await self.db.execute(fill_q)
            questions.extend(fill_result.scalars().all())
        
        hearts = await self.get_hearts(student_id)
        
        topic_name = None
        if topic_id:
            topic = await self.db.get(Topic, topic_id)
            if topic:
                topic_name = topic.name
        
        return {
            "subject_id": subject_id,
            "topic_id": topic_id,
            "topic_name": topic_name,
            "difficulty": difficulty,
            "questions": [
                {
                    "id": q.id,
                    "question_text": q.question_text,
                    "question_type": q.question_type,
                    "options": q.options,
                    "difficulty_level": q.difficulty_level,
                    "bloom_taxonomy_level": q.bloom_taxonomy_level,
                    "marks": q.marks or 1,
                    "topic_id": q.topic_id,
                }
                for q in questions
            ],
            "total_questions": len(questions),
            "hearts_remaining": hearts,
        }

    # --- Submit Lesson ---

    async def submit_lesson(self, student_id: UUID, submission: dict) -> dict:
        """Process lesson submission and update gamification state."""
        subject_id = submission["subject_id"]
        topic_id = submission.get("topic_id")
        answers = submission["answers"]
        
        user = await self.db.get(User, student_id)
        if not user:
            raise ValueError("User not found")
        
        # Process each answer
        results = []
        total_xp = 0
        correct_count = 0
        total_marks = 0
        hearts_remaining = await self.get_hearts(student_id)
        
        question_details = []  # For AI tutor feedback
        for ans in answers:
            question = await self.db.get(Question, ans["question_id"])
            if not question:
                continue
            
            is_correct = False
            if question.correct_answer:
                # Compare just the option letter (first char) to handle format variations
                # e.g. selected might be "A" or "A) text", correct might be "A" or "a"
                selected = ans["selected_answer"].strip()
                correct = question.correct_answer.strip()
                is_correct = selected[0:1].upper() == correct[0:1].upper()
            
            difficulty = question.difficulty_level or "easy"
            xp = calculate_xp(difficulty, user.streak_count, is_correct)
            
            if is_correct:
                correct_count += 1
            else:
                # Use heart on wrong answer
                hearts_remaining = await self.use_heart(student_id)
            
            total_xp += xp
            total_marks += question.marks or 1
            
            results.append({
                "question_id": question.id,
                "is_correct": is_correct,
                "correct_answer": question.correct_answer or "",
                "xp_earned": xp,
                "explanation": question.explanation,
            })
            question_details.append({
                "question_text": question.question_text,
                "options": question.options or [],
                "selected_answer": ans["selected_answer"].strip(),
                "correct_answer": question.correct_answer or "",
                "is_correct": is_correct,
            })
        
        total_questions = len(results)
        accuracy = (correct_count / total_questions * 100) if total_questions > 0 else 0
        
        # Perfect round bonus
        if correct_count == total_questions and total_questions > 0:
            total_xp += XP_PERFECT_BONUS
        
        # Update user XP
        user.xp_total += total_xp
        new_level = calculate_level(user.xp_total)
        level_up = new_level > calculate_level(user.xp_total - total_xp)
        
        # Update streak
        new_streak, streak_maintained = await self.update_streak(student_id)
        
        # Update progress
        mastery_change = 0.0
        new_mastery = 0.0
        if topic_id:
            # Use upsert to handle race conditions
            from sqlalchemy.dialects.postgresql import insert as pg_insert
            
            # First, try to get existing progress
            progress = await self.db.execute(
                select(StudentProgress).where(
                    and_(
                        StudentProgress.student_id == student_id,
                        StudentProgress.subject_id == subject_id,
                        StudentProgress.topic_id == topic_id,
                    )
                )
            )
            p = progress.scalar_one_or_none()
            
            if not p:
                # Use upsert to safely insert or update
                stmt = pg_insert(StudentProgress).values(
                    student_id=student_id,
                    subject_id=subject_id,
                    topic_id=topic_id,
                    topic_mastery=0.0,
                    xp_earned=0,
                    current_level=1,
                    accuracy_percentage=0.0,
                    questions_attempted=0,
                    questions_correct=0,
                    current_difficulty="easy",
                ).on_conflict_do_nothing(
                    constraint="uq_student_topic_progress"
                )
                await self.db.execute(stmt)
                await self.db.flush()
                
                # Re-fetch the record (either just inserted or already existed)
                progress = await self.db.execute(
                    select(StudentProgress).where(
                        and_(
                            StudentProgress.student_id == student_id,
                            StudentProgress.subject_id == subject_id,
                            StudentProgress.topic_id == topic_id,
                        )
                    )
                )
                p = progress.scalar_one()
            
            old_mastery = p.topic_mastery
            p.questions_attempted += total_questions
            p.questions_correct += correct_count
            p.xp_earned += total_xp
            p.accuracy_percentage = (p.questions_correct / p.questions_attempted * 100) if p.questions_attempted > 0 else 0
            
            # Mastery adjustment
            mastery_change = (correct_count * MASTERY_CORRECT_GAIN) - ((total_questions - correct_count) * MASTERY_WRONG_LOSS)
            p.topic_mastery = max(0.0, min(MASTERY_MAX, p.topic_mastery + mastery_change))
            new_mastery = p.topic_mastery
            
            # Adaptive difficulty
            if p.accuracy_percentage < DIFFICULTY_EASY_THRESHOLD:
                p.current_difficulty = "easy"
            elif p.accuracy_percentage > DIFFICULTY_HARD_THRESHOLD:
                p.current_difficulty = "hard"
            else:
                p.current_difficulty = "medium"
            
            p.current_level = new_level
        
        # Generate AI tutor feedback
        tutor_feedback = await generate_tutor_feedback(
            question_details, correct_count, total_questions
        )
        
        # Save test history
        test = TestHistory(
            student_id=student_id,
            subject_id=subject_id,
            topic_id=topic_id,
            score=correct_count,
            total_marks=total_marks,
            total_questions=total_questions,
            correct_answers=correct_count,
            xp_earned=total_xp,
            time_taken_seconds=submission.get("total_time_seconds"),
            difficulty=submission.get("difficulty", "easy"),
            answers=[
                {"question_id": str(r["question_id"]), "correct": r["is_correct"], "xp": r["xp_earned"]}
                for r in results
            ],
            tutor_feedback=tutor_feedback,
        )
        self.db.add(test)
        
        # Update daily activity
        today = date.today()
        daily = await self.db.execute(
            select(DailyActivity).where(
                and_(DailyActivity.student_id == student_id, DailyActivity.activity_date == today)
            )
        )
        d = daily.scalar_one_or_none()
        if not d:
            d = DailyActivity(student_id=student_id, activity_date=today)
            self.db.add(d)
            await self.db.flush()
        
        d.xp_earned += total_xp
        d.questions_answered += total_questions
        d.correct_answers += correct_count
        d.lessons_completed += 1
        d.time_spent_seconds += submission.get("total_time_seconds", 0)
        
        await self.db.commit()
        
        return {
            "score": correct_count,
            "total_marks": total_marks,
            "total_questions": total_questions,
            "correct_answers": correct_count,
            "xp_earned": total_xp,
            "streak_maintained": streak_maintained,
            "new_streak_count": new_streak,
            "hearts_remaining": hearts_remaining,
            "mastery_change": mastery_change,
            "new_mastery": new_mastery,
            "level_up": level_up,
            "new_level": new_level,
            "results": results,
            "accuracy": accuracy,
            "tutor_feedback": tutor_feedback,
        }

    async def process_test_submission(
        self, student_id: UUID, subject_id: UUID, title: str, 
        correct_count: int, total_marks: int, total_questions: int, 
        total_time_seconds: int, results: list,
        question_details: Optional[list] = None,
    ) -> dict:
        """Process a teacher test submission to grant XP and update gamification state."""
        user = await self.db.get(User, student_id)
        if not user:
            return {}

        total_xp = 0
        for r in results:
            if r["is_correct"]:
                # Award XP based on question difficulty, if available. For tests, default to medium
                # We could pull difficulty from the question, but for simplicity:
                xp = calculate_xp("medium", user.streak_count, True)
                total_xp += xp

        if correct_count == total_questions and total_questions > 0:
            total_xp += XP_PERFECT_BONUS

        user.xp_total += total_xp

        # Generate AI tutor feedback
        tutor_feedback = None
        if question_details:
            tutor_feedback = await generate_tutor_feedback(
                question_details, correct_count, total_questions
            )

        # Save test history so it appears in profile 
        test = TestHistory(
            student_id=student_id,
            subject_id=subject_id,
            score=correct_count,
            total_marks=total_marks,
            total_questions=total_questions,
            correct_answers=correct_count,
            xp_earned=total_xp,
            time_taken_seconds=total_time_seconds,
            difficulty="test",  # Special marker for teacher tests
            answers=[
                {"question_id": r["question_id"], "correct": r["is_correct"], "xp": 0}
                for r in results
            ],
            tutor_feedback=tutor_feedback,
        )
        self.db.add(test)
        
        # Update daily activity
        today = date.today()
        daily = await self.db.execute(
            select(DailyActivity).where(
                and_(DailyActivity.student_id == student_id, DailyActivity.activity_date == today)
            )
        )
        d = daily.scalar_one_or_none()
        if not d:
            d = DailyActivity(student_id=student_id, activity_date=today)
            self.db.add(d)
            await self.db.flush()
        
        d.xp_earned += total_xp
        d.questions_answered += total_questions
        d.correct_answers += correct_count
        d.time_spent_seconds += total_time_seconds or 0
        
        await self.db.commit()
        return {"xp_earned": total_xp, "tutor_feedback": tutor_feedback}

    # --- Profile ---

    async def get_profile(self, student_id: UUID) -> dict:
        """Get gamification profile for a student."""
        user = await self.db.get(User, student_id)
        if not user:
            raise ValueError("User not found")
        
        # Count enrollments
        enroll_count = await self.db.execute(
            select(func.count(Enrollment.id)).where(
                and_(Enrollment.student_id == student_id, Enrollment.is_active == True)
            )
        )
        subjects_enrolled = enroll_count.scalar() or 0
        
        # Total lessons
        lesson_count = await self.db.execute(
            select(func.count(TestHistory.id)).where(TestHistory.student_id == student_id)
        )
        total_lessons = lesson_count.scalar() or 0
        
        # Total questions and accuracy
        stats = await self.db.execute(
            select(
                func.sum(DailyActivity.questions_answered),
                func.sum(DailyActivity.correct_answers),
            ).where(DailyActivity.student_id == student_id)
        )
        row = stats.one()
        total_q = int(row[0] or 0)
        total_correct = int(row[1] or 0)
        overall_accuracy = (total_correct / total_q * 100) if total_q > 0 else 0
        
        return {
            "user_id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "avatar_url": user.avatar_url,
            "role": user.role,
            "xp_total": user.xp_total,
            "streak_count": user.streak_count,
            "hearts": await self.get_hearts(student_id),
            "current_level": calculate_level(user.xp_total),
            "badges": get_badges(user.streak_count),
            "subjects_enrolled": subjects_enrolled,
            "total_lessons_completed": total_lessons,
            "total_questions_answered": total_q,
            "overall_accuracy": overall_accuracy,
        }

    # --- Leaderboard ---

    async def get_leaderboard(self, student_id: UUID, limit: int = 20, subject_id: Optional[UUID] = None) -> dict:
        """Get XP leaderboard. If subject_id is provided, returns class-wise leaderboard."""
        from app.models.gamification import Enrollment
        
        if subject_id:
            # Class-wise leaderboard: only students enrolled in this subject
            # Calculate XP from their test history in this subject
            from app.models.gamification import TestHistory
            result = await self.db.execute(
                select(User, TestHistory)
                .join(Enrollment, User.id == Enrollment.student_id)
                .outerjoin(
                    TestHistory,
                    (User.id == TestHistory.student_id) & (TestHistory.subject_id == subject_id)
                )
                .where(User.role == "student")
                .where(Enrollment.subject_id == subject_id)
                .where(Enrollment.status == "approved")
            )
            rows = result.all()
            
            # Aggregate XP per user for this subject
            user_xp: dict = {}
            for user, history in rows:
                if user.id not in user_xp:
                    user_xp[user.id] = {
                        "user": user,
                        "xp": 0
                    }
                if history:
                    user_xp[user.id]["xp"] += history.xp_earned
            
            # Sort by XP descending
            sorted_users = sorted(user_xp.values(), key=lambda x: x["xp"], reverse=True)[:limit]
            
            entries = []
            current_rank = None
            for i, item in enumerate(sorted_users, 1):
                u = item["user"]
                entries.append({
                    "rank": i,
                    "user_id": u.id,
                    "username": u.username,
                    "full_name": u.full_name,
                    "avatar_url": u.avatar_url,
                    "xp_total": item["xp"],
                    "streak_count": u.streak_count,
                    "level": calculate_level(item["xp"]),
                })
                if u.id == student_id:
                    current_rank = i
            
            # Count total students in this subject
            total = await self.db.execute(
                select(func.count(Enrollment.id))
                .where(Enrollment.subject_id == subject_id)
                .where(Enrollment.status == "approved")
            )
            total_students = total.scalar() or 0
            
            return {
                "entries": entries,
                "total_students": total_students,
                "current_user_rank": current_rank,
            }
        else:
            # Global leaderboard
            result = await self.db.execute(
                select(User)
                .where(User.role == "student")
                .order_by(desc(User.xp_total))
                .limit(limit)
            )
            users = result.scalars().all()
            
            entries = []
            current_rank = None
            for i, u in enumerate(users, 1):
                entries.append({
                    "rank": i,
                    "user_id": u.id,
                    "username": u.username,
                    "full_name": u.full_name,
                    "avatar_url": u.avatar_url,
                    "xp_total": u.xp_total,
                    "streak_count": u.streak_count,
                    "level": calculate_level(u.xp_total),
                })
                if u.id == student_id:
                    current_rank = i
            
            # Count total students
            total = await self.db.execute(
                select(func.count(User.id)).where(User.role == "student")
            )
            total_students = total.scalar() or 0
            
            return {
                "entries": entries,
                "total_students": total_students,
                "current_user_rank": current_rank,
            }

    # --- Test History ---

    async def get_test_history(self, student_id: UUID, subject_id: Optional[UUID] = None, limit: int = 20) -> List[dict]:
        """Get test history for a student."""
        q = select(TestHistory).where(TestHistory.student_id == student_id)
        if subject_id:
            q = q.where(TestHistory.subject_id == subject_id)
        q = q.order_by(desc(TestHistory.created_at)).limit(limit)
        
        result = await self.db.execute(q)
        tests = result.scalars().all()
        
        return [
            {
                "id": t.id,
                "student_id": t.student_id,
                "subject_id": t.subject_id,
                "topic_id": t.topic_id,
                "score": t.score,
                "total_marks": t.total_marks,
                "total_questions": t.total_questions,
                "correct_answers": t.correct_answers,
                "xp_earned": t.xp_earned,
                "time_taken_seconds": t.time_taken_seconds,
                "difficulty": t.difficulty,
                "tutor_feedback": t.tutor_feedback,
                "created_at": t.created_at,
            }
            for t in tests
        ]

    # --- Daily Activity ---

    async def get_daily_activity(self, student_id: UUID, days: int = 30) -> List[dict]:
        """Get recent daily activity."""
        start_date = date.today() - timedelta(days=days)
        result = await self.db.execute(
            select(DailyActivity)
            .where(
                and_(
                    DailyActivity.student_id == student_id,
                    DailyActivity.activity_date >= start_date,
                )
            )
            .order_by(desc(DailyActivity.activity_date))
        )
        activities = result.scalars().all()
        
        return [
            {
                "id": a.id,
                "student_id": a.student_id,
                "activity_date": a.activity_date,
                "xp_earned": a.xp_earned,
                "questions_answered": a.questions_answered,
                "correct_answers": a.correct_answers,
                "time_spent_seconds": a.time_spent_seconds,
                "lessons_completed": a.lessons_completed,
            }
            for a in activities
        ]
    
    # --- Progress per subject ---

    async def get_subject_progress(self, student_id: UUID, subject_id: UUID) -> List[dict]:
        """Get progress for all topics in a subject."""
        result = await self.db.execute(
            select(StudentProgress, Topic.name)
            .outerjoin(Topic, StudentProgress.topic_id == Topic.id)
            .where(
                and_(
                    StudentProgress.student_id == student_id,
                    StudentProgress.subject_id == subject_id,
                )
            )
        )
        rows = result.all()
        
        return [
            {
                "id": p.id,
                "student_id": p.student_id,
                "subject_id": p.subject_id,
                "topic_id": p.topic_id,
                "topic_name": name,
                "topic_mastery": p.topic_mastery,
                "xp_earned": p.xp_earned,
                "current_level": p.current_level,
                "accuracy_percentage": p.accuracy_percentage,
                "questions_attempted": p.questions_attempted,
                "questions_correct": p.questions_correct,
                "current_difficulty": p.current_difficulty,
            }
            for p, name in rows
        ]
