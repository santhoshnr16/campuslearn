"""
Test service for teacher-created assessments.
Handles test creation, question generation from approved pool, publishing, and performance analytics.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from uuid import UUID

from sqlalchemy import select, func, and_, desc, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.test import Test, TestQuestion, TestSubmission
from app.models.question import Question, GenerationSession
from app.models.subject import Subject, Topic
from app.models.user import User
from app.core.logging import logger


class TestService:
    """Service for managing teacher tests."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ========================
    # Test CRUD
    # ========================

    async def create_test(self, teacher_id: UUID, data: dict) -> Test:
        """Create a new test (draft)."""
        test = Test(
            teacher_id=teacher_id,
            subject_id=data["subject_id"],
            title=data["title"],
            description=data.get("description"),
            instructions=data.get("instructions"),
            generation_type=data.get("generation_type", "subject_wise"),
            difficulty_config=data.get("difficulty_config"),
            topic_config=data.get("topic_config"),
            duration_minutes=data.get("duration_minutes"),
            status="draft",
        )
        self.db.add(test)
        await self.db.commit()
        await self.db.refresh(test)
        return test

    async def get_test(self, test_id: UUID, teacher_id: Optional[UUID] = None) -> Optional[Test]:
        """Get a test by ID, optionally filtered by teacher."""
        query = select(Test).where(Test.id == test_id)
        if teacher_id:
            query = query.where(Test.teacher_id == teacher_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def list_tests(self, teacher_id: UUID, status: Optional[str] = None) -> List[dict]:
        """List tests for a teacher with summary info."""
        query = (
            select(
                Test,
                Subject.name.label("subject_name"),
                Subject.code.label("subject_code"),
                func.count(TestSubmission.id).label("submissions_count"),
                func.avg(TestSubmission.percentage).label("average_score"),
            )
            .join(Subject, Test.subject_id == Subject.id)
            .outerjoin(TestSubmission, and_(
                TestSubmission.test_id == Test.id,
                TestSubmission.status == "submitted",
            ))
            .where(Test.teacher_id == teacher_id)
            .group_by(Test.id, Subject.name, Subject.code)
            .order_by(desc(Test.updated_at))
        )
        if status:
            query = query.where(Test.status == status)

        result = await self.db.execute(query)
        rows = result.all()

        tests = []
        for row in rows:
            test = row[0]
            tests.append({
                "id": test.id,
                "teacher_id": test.teacher_id,
                "subject_id": test.subject_id,
                "title": test.title,
                "description": test.description,
                "instructions": test.instructions,
                "generation_type": test.generation_type,
                "difficulty_config": test.difficulty_config,
                "topic_config": test.topic_config,
                "total_questions": test.total_questions,
                "total_marks": test.total_marks,
                "duration_minutes": test.duration_minutes,
                "status": test.status,
                "published_at": test.published_at,
                "unpublished_at": test.unpublished_at,
                "created_at": test.created_at,
                "updated_at": test.updated_at,
                "subject_name": row[1],
                "subject_code": row[2],
                "submissions_count": row[3] or 0,
                "average_score": round(float(row[4]), 1) if row[4] else None,
            })
        return tests

    async def update_test(self, test_id: UUID, teacher_id: UUID, data: dict) -> Optional[Test]:
        """Update test details."""
        test = await self.get_test(test_id, teacher_id)
        if not test:
            return None

        for key, value in data.items():
            if value is not None and hasattr(test, key):
                setattr(test, key, value)

        await self.db.commit()
        await self.db.refresh(test)
        return test

    async def delete_test(self, test_id: UUID, teacher_id: UUID) -> bool:
        """Delete a test (only draft/unpublished)."""
        test = await self.get_test(test_id, teacher_id)
        if not test:
            return False
        if test.status == "published":
            return False
        await self.db.delete(test)
        await self.db.commit()
        return True

    # ========================
    # Generate Questions for Test
    # ========================

    async def generate_test_questions(self, test_id: UUID, teacher_id: UUID) -> dict:
        """
        Generate NEW questions for a test using the LLM RAG pipeline.
        Creates fresh questions from the subject's uploaded documents,
        saves them to the question bank, and links them to the test.
        Questions follow pedagogical progression: easy → medium → hard.
        """
        from app.models.document import Document, DocumentChunk
        from app.services.question_service import QuestionGenerationService
        from app.services.embedding_service import EmbeddingService
        from app.services.llm_service import LLMService
        from app.services.redis_service import RedisService
        from app.services.document_service import DocumentService
        from app.services.reranker_service import RerankerService
        from app.core.config import settings

        test = await self.get_test(test_id, teacher_id)
        if not test:
            raise ValueError("Test not found")
        if test.status == "published":
            raise ValueError("Cannot regenerate questions for a published test")

        # Clear existing test questions
        existing = await self.db.execute(
            select(TestQuestion).where(TestQuestion.test_id == test_id)
        )
        for tq in existing.scalars().all():
            await self.db.delete(tq)
        await self.db.flush()

        # Find completed documents for this subject
        doc_result = await self.db.execute(
            select(Document).where(
                and_(
                    Document.subject_id == test.subject_id,
                    Document.processing_status == "completed",
                )
            ).order_by(Document.upload_timestamp.desc())
        )
        documents = doc_result.scalars().all()
        if not documents:
            raise ValueError(
                "No processed documents found for this subject. "
                "Please upload and process documents first."
            )

        primary_doc = documents[0]
        logger.info(
            f"Generating test questions for test {test_id} using document "
            f"'{primary_doc.filename}' (subject={test.subject_id})"
        )

        # Get document chunks
        chunk_result = await self.db.execute(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == primary_doc.id)
            .order_by(DocumentChunk.chunk_index)
        )
        chunks = chunk_result.scalars().all()
        if not chunks:
            raise ValueError("Document has no content chunks. Please re-upload.")

        # Initialize the question generation service
        embedding_service = EmbeddingService()
        llm_service = LLMService()
        redis_service = RedisService()
        document_service = DocumentService(self.db, embedding_service)

        reranker_service = None
        if settings.RERANKER_ENABLED:
            reranker_service = RerankerService()

        qgen_service = QuestionGenerationService(
            db=self.db,
            embedding_service=embedding_service,
            llm_service=llm_service,
            redis_service=redis_service,
            document_service=document_service,
            reranker_service=reranker_service,
        )

        # Build difficulty pool or plan based on config
        difficulty_config = test.difficulty_config or {}
        difficulty_pool = []
        for level in ["easy", "medium", "hard"]:
            cfg = difficulty_config.get(level)
            if isinstance(cfg, dict) and cfg.get("count", 0) > 0:
                difficulty_pool.extend([level] * cfg["count"])
        
        if not difficulty_pool:
            difficulty_pool = ["easy"] * 4 + ["medium"] * 3 + ["hard"] * 3
            
        generation_plan: List[Dict[str, Any]] = []
        topic_config = test.topic_config or []

        if test.generation_type in ("topic_wise", "multi_topic") and topic_config:
            diff_idx = 0
            for topic in topic_config:
                t_count = topic.get("count", 5)
                if not isinstance(t_count, int):
                    try:
                        t_count = int(t_count)
                    except:
                        t_count = 5
                
                t_id_str = topic.get("topic_id")
                t_name = topic.get("topic_name", "")
                
                t_diff_counts = {"easy": 0, "medium": 0, "hard": 0}
                for _ in range(t_count):
                    diff = difficulty_pool[diff_idx % len(difficulty_pool)]
                    t_diff_counts[diff] += 1
                    diff_idx += 1
                
                for level, count in t_diff_counts.items():
                    if count > 0:
                        generation_plan.append({
                            "difficulty": level,
                            "count": count,
                            "focus_topics": [t_name] if t_name else None,
                            "topic_id": t_id_str
                        })
        else:
            for level in ["easy", "medium", "hard"]:
                cfg = difficulty_config.get(level)
                if isinstance(cfg, dict) and cfg.get("count", 0) > 0:
                    generation_plan.append({
                        "difficulty": level,
                        "count": cfg["count"],
                        "focus_topics": cfg.get("lo_mapping") or None,
                        "topic_id": None
                    })
            if not generation_plan:
                generation_plan = [
                    {"difficulty": "easy", "count": 4, "focus_topics": None, "topic_id": None},
                    {"difficulty": "medium", "count": 3, "focus_topics": None, "topic_id": None},
                    {"difficulty": "hard", "count": 3, "focus_topics": None, "topic_id": None},
                ]

        # Build blacklist from existing questions for this subject (deduplication)
        blacklist_result = await self.db.execute(
            select(Question).where(
                and_(
                    Question.subject_id == test.subject_id,
                    Question.is_archived == False,
                )
            )
        )
        existing_questions = blacklist_result.scalars().all()
        blacklist_embeddings = []
        for q in existing_questions:
            if q.question_embedding is not None and len(q.question_embedding) > 0:
                blacklist_embeddings.append(q.question_embedding)

        # Reference book doc IDs for expanded search
        all_doc_ids = [d.id for d in documents]

        # Generate questions per difficulty level
        generated_questions: List[Question] = []
        total_marks = 0
        order_index = 0

        # Create a proper GenerationSession so questions appear in History
        total_requested = sum(p["count"] for p in generation_plan)
        session = GenerationSession(
            user_id=teacher_id,
            document_id=primary_doc.id,
            subject_id=test.subject_id,
            generation_method="quick",
            requested_count=total_requested,
            requested_types=["mcq"],
            status="in_progress",
            generation_config={"test_id": str(test_id), "test_title": test.title},
        )
        self.db.add(session)
        await self.db.flush()
        session_id = session.id

        questions_failed = 0

        for plan in generation_plan:
            difficulty = plan["difficulty"]
            count = plan["count"]
            marks_per_q = self._get_marks_for_difficulty(difficulty)
            focus = plan.get("focus_topics")
            topic_id_str = plan.get("topic_id")

            logger.info(
                f"Generating {count} {difficulty} questions for test {test_id}"
            )

            generated_for_plan = 0
            max_retries_per_q = 10  # retry up to 10 times per question slot
            attempts = 0
            max_total_attempts = count * (max_retries_per_q + 2)  # hard ceiling

            while generated_for_plan < count and attempts < max_total_attempts:
                attempts += 1
                try:
                    # Select relevant chunks
                    focus_topics_for_chunk = focus
                    selected_chunks = await qgen_service._select_chunks(
                        chunks=chunks,
                        focus_topics=focus_topics_for_chunk,
                        blacklist_chunks=set(),
                        num_chunks=3,
                        document_id=primary_doc.id,
                        document_ids=all_doc_ids,
                    )

                    # Generate a single MCQ question
                    question_data = await qgen_service._generate_single_question(
                        chunks=selected_chunks,
                        question_type="mcq",
                        difficulty=difficulty,
                        marks=marks_per_q,
                        bloom_levels=None,
                    )

                    if not question_data:
                        logger.warning(f"LLM returned no data for question attempt {attempts} ({difficulty})")
                        continue

                    # Check for duplicates against existing + newly generated
                    # Threshold of 0.92 avoids false positives on semantically-similar-but-distinct questions
                    is_duplicate = await qgen_service._check_duplicate(
                        question_text=question_data["question_text"],
                        blacklist_embeddings=blacklist_embeddings,
                        threshold=0.92,
                    )
                    if is_duplicate:
                        logger.info(f"Duplicate detected ({difficulty} attempt {attempts}), retrying...")
                        continue

                    # Save question to the question bank
                    question_obj, _ = await qgen_service._save_question(
                        document_id=primary_doc.id,
                        session_id=session_id,
                        question_data=question_data,
                        question_type="mcq",
                        marks=marks_per_q,
                        difficulty=difficulty,
                        chunk_ids=[c.id for c in selected_chunks],
                        chunks=selected_chunks,
                        subject_id=test.subject_id,
                        topic_id=uuid.UUID(topic_id_str) if topic_id_str else None,
                    )

                    # Add to blacklist for future dedup within this batch
                    if question_obj.question_embedding is not None:
                        blacklist_embeddings.append(question_obj.question_embedding)

                    # Link to test
                    tq = TestQuestion(
                        test_id=test_id,
                        question_id=question_obj.id,
                        order_index=order_index,
                        marks=marks_per_q,
                    )
                    self.db.add(tq)
                    total_marks += marks_per_q
                    order_index += 1
                    generated_for_plan += 1
                    generated_questions.append(question_obj)

                    logger.info(
                        f"Generated {difficulty} question {generated_for_plan}/{count} for test {test_id}"
                    )

                except Exception as e:
                    logger.error(
                        f"Failed to generate {difficulty} question (attempt {attempts}): {e}"
                    )
                    questions_failed += 1
                    continue

            if generated_for_plan < count:
                logger.warning(
                    f"Could only generate {generated_for_plan}/{count} {difficulty} "
                    f"questions after {attempts} attempts for test {test_id}"
                )

        if not generated_questions:
            raise ValueError(
                "Failed to generate any questions. Please check that the subject "
                "has uploaded documents with sufficient content."
            )

        # Update test totals
        test.total_questions = len(generated_questions)
        test.total_marks = total_marks

        # Update the generation session
        session.status = "completed"
        session.questions_generated = len(generated_questions)
        session.questions_failed = questions_failed
        session.completed_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(test)

        logger.info(
            f"✅ Test {test_id}: generated {len(generated_questions)} questions "
            f"({total_marks} marks) via LLM"
        )

        return {
            "test_id": test.id,
            "questions_added": len(generated_questions),
            "total_marks": total_marks,
        }

    def _get_marks_for_difficulty(self, difficulty: Optional[str]) -> int:
        """Assign default marks based on difficulty."""
        return {"easy": 1, "medium": 2, "hard": 3}.get(difficulty or "easy", 1)

    # ========================
    # Publishing
    # ========================

    async def publish_test(self, test_id: UUID, teacher_id: UUID) -> Optional[Test]:
        """Publish a test, making it available to students."""
        test = await self.get_test(test_id, teacher_id)
        if not test:
            return None
        if test.total_questions == 0:
            raise ValueError("Cannot publish a test with no questions. Generate questions first.")

        test.status = "published"
        test.published_at = datetime.now(timezone.utc)
        test.unpublished_at = None

        # Auto-publish the subject so students can discover it
        subject_result = await self.db.execute(
            select(Subject).where(Subject.id == test.subject_id)
        )
        subject = subject_result.scalar_one_or_none()
        if subject and not subject.published:
            subject.published = True
            logger.info(f"Auto-published subject {subject.id} ({subject.name})")

        await self.db.commit()
        await self.db.refresh(test)
        return test

    async def unpublish_test(self, test_id: UUID, teacher_id: UUID) -> Optional[Test]:
        """Unpublish a test."""
        test = await self.get_test(test_id, teacher_id)
        if not test:
            return None

        test.status = "unpublished"
        test.unpublished_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(test)
        return test

    # ========================
    # Test Questions Management
    # ========================

    async def get_test_questions(self, test_id: UUID) -> List[dict]:
        """Get all questions for a test with details."""
        query = (
            select(TestQuestion, Question, Topic.name.label("topic_name"))
            .join(Question, TestQuestion.question_id == Question.id)
            .outerjoin(Topic, Question.topic_id == Topic.id)
            .where(TestQuestion.test_id == test_id)
            .order_by(TestQuestion.order_index)
        )
        result = await self.db.execute(query)
        rows = result.all()

        questions = []
        for row in rows:
            tq = row[0]
            q = row[1]
            topic_name = row[2]
            questions.append({
                "id": tq.id,
                "test_id": tq.test_id,
                "question_id": q.id,
                "order_index": tq.order_index,
                "marks": tq.marks,
                "question_text_override": tq.question_text_override,
                "options_override": tq.options_override,
                "correct_answer_override": tq.correct_answer_override,
                "question_text": tq.question_text_override or q.question_text,
                "question_type": q.question_type,
                "options": tq.options_override or q.options,
                "correct_answer": tq.correct_answer_override or q.correct_answer,
                "explanation": q.explanation,
                "difficulty_level": q.difficulty_level,
                "bloom_taxonomy_level": q.bloom_taxonomy_level,
                "topic_name": topic_name,
                "learning_outcome_id": q.learning_outcome_id,
            })
        return questions

    async def get_submissions_count(self, test_id: UUID) -> int:
        """Get total submissions count for a test."""
        result = await self.db.execute(
            select(func.count(TestSubmission.id)).where(TestSubmission.test_id == test_id)
        )
        return result.scalar() or 0

    async def update_test_question(
        self, test_id: UUID, test_question_id: UUID, teacher_id: UUID, data: dict
    ) -> Optional[dict]:
        """Update a question within a test (override text, marks, etc.)."""
        # Verify teacher owns the test
        test = await self.get_test(test_id, teacher_id)
        if not test:
            return None

        result = await self.db.execute(
            select(TestQuestion).where(
                and_(TestQuestion.id == test_question_id, TestQuestion.test_id == test_id)
            )
        )
        tq = result.scalar_one_or_none()
        if not tq:
            return None

        old_marks = tq.marks
        for key, value in data.items():
            if value is not None and hasattr(tq, key):
                setattr(tq, key, value)

        # Update total marks if marks changed
        if "marks" in data and data["marks"] is not None and data["marks"] != old_marks:
            test.total_marks = test.total_marks - old_marks + data["marks"]

        await self.db.commit()
        return {"status": "updated"}

    async def remove_test_question(
        self, test_id: UUID, test_question_id: UUID, teacher_id: UUID
    ) -> bool:
        """Remove a question from a test."""
        test = await self.get_test(test_id, teacher_id)
        if not test:
            return False

        result = await self.db.execute(
            select(TestQuestion).where(
                and_(TestQuestion.id == test_question_id, TestQuestion.test_id == test_id)
            )
        )
        tq = result.scalar_one_or_none()
        if not tq:
            return False

        test.total_questions -= 1
        test.total_marks -= tq.marks
        await self.db.delete(tq)
        await self.db.commit()
        return True

    # ========================
    # Student-facing
    # ========================

    async def get_published_tests_for_student(self, student_id: UUID) -> List[dict]:
        """Get published tests for subjects the student is enrolled in."""
        from app.models.gamification import Enrollment

        query = (
            select(
                Test,
                Subject.name.label("subject_name"),
                Subject.code.label("subject_code"),
                TestSubmission.id.label("submission_id"),
                TestSubmission.percentage.label("submission_percentage"),
                TestSubmission.status.label("submission_status"),
            )
            .join(Subject, Test.subject_id == Subject.id)
            .join(
                Enrollment,
                and_(
                    Enrollment.subject_id == Test.subject_id,
                    Enrollment.student_id == student_id,
                    Enrollment.is_active == True,
                ),
            )
            .outerjoin(
                TestSubmission,
                and_(
                    TestSubmission.test_id == Test.id,
                    TestSubmission.student_id == student_id,
                ),
            )
            .where(Test.status == "published")
            .order_by(desc(Test.published_at))
        )
        result = await self.db.execute(query)
        rows = result.all()

        tests = []
        for row in rows:
            test = row[0]
            tests.append({
                "id": test.id,
                "title": test.title,
                "description": test.description,
                "instructions": test.instructions,
                "subject_name": row[1],
                "subject_code": row[2],
                "total_questions": test.total_questions,
                "total_marks": test.total_marks,
                "duration_minutes": test.duration_minutes,
                "published_at": test.published_at,
                "has_submitted": row[3] is not None,
                "submission_percentage": float(row[4]) if row[4] else None,
                "submission_status": row[5],
            })
        return tests

    async def get_test_for_student(self, test_id: UUID, student_id: UUID) -> Optional[dict]:
        """Get test details and questions for a student to take."""
        import random
        
        test = await self.get_test(test_id)
        if not test or test.status != "published":
            return None

        # Check previous submissions (for info, but allow re-attempts)
        result = await self.db.execute(
            select(TestSubmission).where(
                and_(
                    TestSubmission.test_id == test_id,
                    TestSubmission.student_id == student_id,
                    TestSubmission.status == "submitted",
                )
            ).order_by(TestSubmission.submitted_at.desc())
        )
        previous_submission = result.scalar_one_or_none()

        # Get questions (without correct answers)
        questions = await self.get_test_questions(test_id)
        for q in questions:
            q.pop("correct_answer", None)
            q.pop("correct_answer_override", None)
            q.pop("explanation", None)
            # Shuffle options if present
            if q.get("options"):
                random.shuffle(q["options"])
        
        # Shuffle questions order
        random.shuffle(questions)

        return {
            "id": test.id,
            "title": test.title,
            "description": test.description,
            "instructions": test.instructions,
            "total_questions": test.total_questions,
            "total_marks": test.total_marks,
            "duration_minutes": test.duration_minutes,
            "questions": questions,
            "previous_attempt": {
                "score": previous_submission.score,
                "total_marks": previous_submission.total_marks,
                "submitted_at": previous_submission.submitted_at.isoformat() if previous_submission.submitted_at else None,
            } if previous_submission else None,
        }

    async def submit_test(self, test_id: UUID, student_id: UUID, data: dict) -> dict:
        """Submit student answers for a test and calculate score."""
        test = await self.get_test(test_id)
        if not test or test.status != "published":
            raise ValueError("Test not available")

        # Check for existing submission (for re-attempts, we update it)
        result = await self.db.execute(
            select(TestSubmission).where(
                and_(
                    TestSubmission.test_id == test_id,
                    TestSubmission.student_id == student_id,
                )
            )
        )
        existing_submission = result.scalar_one_or_none()

        # Get questions with answers
        questions = await self.get_test_questions(test_id)
        question_map = {str(q["question_id"]): q for q in questions}

        answers = data.get("answers", [])
        score = 0
        total_marks = test.total_marks
        answer_results = []

        for ans in answers:
            q_id = str(ans["question_id"])
            q = question_map.get(q_id)
            if not q:
                continue

            correct = q.get("correct_answer", "")
            selected = ans.get("selected_answer", "")
            is_correct = self._check_answer(selected, correct)
            marks_obtained = q["marks"] if is_correct else 0
            score += marks_obtained

            answer_results.append({
                "question_id": q_id,
                "selected_answer": selected,
                "is_correct": is_correct,
                "marks_obtained": marks_obtained,
                "correct_answer": correct,
                "explanation": q.get("explanation"),
                "time_taken_seconds": ans.get("time_taken_seconds"),
            })

        percentage = round((score / total_marks * 100), 1) if total_marks > 0 else 0.0

        if existing_submission:
            # Update existing submission for re-attempt
            existing_submission.score = score
            existing_submission.total_marks = total_marks
            existing_submission.percentage = percentage
            existing_submission.answers = answer_results
            existing_submission.time_taken_seconds = data.get("total_time_seconds")
            existing_submission.status = "submitted"
            existing_submission.submitted_at = datetime.now(timezone.utc)
            submission = existing_submission
        else:
            # Create new submission
            submission = TestSubmission(
                test_id=test_id,
                student_id=student_id,
                score=score,
                total_marks=total_marks,
                percentage=percentage,
                answers=answer_results,
                time_taken_seconds=data.get("total_time_seconds"),
                status="submitted",
                submitted_at=datetime.now(timezone.utc),
            )
            self.db.add(submission)
        
        await self.db.commit()
        await self.db.refresh(submission)

        # Award XP and gamification stats
        tutor_feedback = None
        try:
            from app.services.gamification_service import GamificationService
            gamification = GamificationService(self.db)
            # Build question_details for AI tutor feedback
            question_details = [
                {
                    "question_text": question_map.get(r["question_id"], {}).get("question_text", ""),
                    "options": question_map.get(r["question_id"], {}).get("options", []),
                    "selected_answer": r["selected_answer"],
                    "correct_answer": r["correct_answer"],
                    "is_correct": r["is_correct"],
                }
                for r in answer_results
            ]
            gamification_result = await gamification.process_test_submission(
                student_id=student_id,
                subject_id=test.subject_id,
                title=test.title,
                correct_count=sum(1 for r in answer_results if r["is_correct"]),
                total_marks=total_marks,
                total_questions=len(questions),
                total_time_seconds=data.get("total_time_seconds", 0),
                results=answer_results,
                question_details=question_details,
            )
            tutor_feedback = gamification_result.get("tutor_feedback")
        except Exception as e:
            logger.error(f"Failed to record gamification for test: {e}")

        return {
            "id": submission.id,
            "test_id": test_id,
            "student_id": student_id,
            "score": score,
            "total_marks": total_marks,
            "percentage": percentage,
            "status": "submitted",
            "time_taken_seconds": submission.time_taken_seconds,
            "started_at": submission.started_at,
            "submitted_at": submission.submitted_at,
            "results": answer_results,
            "tutor_feedback": tutor_feedback,
        }

    def _check_answer(self, selected: str, correct: str) -> bool:
        """Check if selected answer matches correct answer."""
        if not selected or not correct:
            return False
        # Compare just the first character (the option letter) to handle format variations
        s = selected.strip().upper()
        c = correct.strip().upper()
        if s == c:
            return True
        # First-character comparison (e.g. "A" vs "A) Option text")
        if s and c and s[0] == c[0] and s[0] in 'ABCDEFGHIJ':
            return True
        return False

    # ========================
    # Performance Analytics
    # ========================

    async def get_test_performance(self, test_id: UUID, teacher_id: UUID) -> dict:
        """Get performance analytics for a specific test."""
        test = await self.get_test(test_id, teacher_id)
        if not test:
            raise ValueError("Test not found")

        # Get all submissions
        result = await self.db.execute(
            select(TestSubmission, User.full_name, User.username)
            .join(User, TestSubmission.student_id == User.id)
            .where(
                and_(
                    TestSubmission.test_id == test_id,
                    TestSubmission.status == "submitted",
                )
            )
            .order_by(desc(TestSubmission.percentage))
        )
        rows = result.all()

        submissions = []
        scores = []
        for row in rows:
            sub = row[0]
            submissions.append({
                "id": sub.id,
                "test_id": sub.test_id,
                "student_id": sub.student_id,
                "score": sub.score,
                "total_marks": sub.total_marks,
                "percentage": sub.percentage,
                "status": sub.status,
                "time_taken_seconds": sub.time_taken_seconds,
                "started_at": sub.started_at,
                "submitted_at": sub.submitted_at,
                "student_name": row[1] or row[2],
                "student_username": row[2],
                "answers": sub.answers,
            })
            scores.append(sub.score)

        # Question-level performance
        questions = await self.get_test_questions(test_id)
        question_perf = []
        for q in questions:
            q_id = str(q["question_id"])
            correct_count = 0
            total_attempts = 0
            time_sum = 0
            time_count = 0

            for sub_data in submissions:
                sub_answers = sub_data.get("answers") or []
                for ans in sub_answers:
                    if str(ans.get("question_id")) == q_id:
                        total_attempts += 1
                        if ans.get("is_correct"):
                            correct_count += 1
                        t = ans.get("time_taken_seconds")
                        if t:
                            time_sum += t
                            time_count += 1

            question_perf.append({
                "question_id": q["question_id"],
                "question_text": q["question_text"],
                "correct_count": correct_count,
                "total_attempts": total_attempts,
                "accuracy": round(correct_count / total_attempts * 100, 1) if total_attempts > 0 else 0.0,
                "average_time_seconds": round(time_sum / time_count, 1) if time_count > 0 else None,
            })

        return {
            "test_id": test.id,
            "test_title": test.title,
            "total_submissions": len(submissions),
            "average_score": round(sum(scores) / len(scores), 1) if scores else 0.0,
            "average_percentage": round(
                sum(s["percentage"] for s in submissions) / len(submissions), 1
            ) if submissions else 0.0,
            "highest_score": max(scores) if scores else 0,
            "lowest_score": min(scores) if scores else 0,
            "submissions": submissions,
            "question_performance": question_perf,
        }
