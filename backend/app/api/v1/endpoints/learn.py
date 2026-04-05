"""
Learning & Gamification API endpoints for students.
"""

from typing import Optional, List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.deps import get_current_active_user
from app.models.user import User
from app.models.subject import Topic
from app.models.gamification import Enrollment
from app.models.document import Document
from app.services.gamification_service import GamificationService
from app.schemas.gamification import (
    EnrollmentCreate,
    EnrollmentResponse,
    StudentProgressResponse,
    LessonResponse,
    LessonSubmission,
    LessonResult,
    TestHistoryResponse,
    DailyActivityResponse,
    GamificationProfile,
    LeaderboardResponse,
    SubjectListStudent,
)

router = APIRouter()


# --- Subjects for students ---

@router.get("/subjects", response_model=list[SubjectListStudent])
async def list_available_subjects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all published subjects with enrollment status."""
    service = GamificationService(db)
    return await service.get_available_subjects(current_user.id)


@router.get("/topics/{subject_id}")
async def list_student_topics(
    subject_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List topics for a subject that the student is enrolled in.
    Returns topic names, IDs, syllabus content, and question counts.
    """
    # Verify enrollment
    enrollment = await db.execute(
        select(Enrollment).where(
            Enrollment.student_id == current_user.id,
            Enrollment.subject_id == subject_id,
            Enrollment.status == "approved",
        )
    )
    if not enrollment.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not enrolled in this subject")

    # Get topics
    result = await db.execute(
        select(Topic)
        .where(Topic.subject_id == subject_id)
        .order_by(Topic.order_index)
    )
    topics = result.scalars().all()

    return {
        "topics": [
            {
                "id": str(t.id),
                "name": t.name,
                "description": t.description,
                "order_index": t.order_index,
                "has_syllabus": t.has_syllabus,
                "syllabus_content": t.syllabus_content if t.has_syllabus else None,
                "total_questions": t.total_questions,
            }
            for t in topics
        ]
    }


@router.get("/references/{subject_id}")
async def list_student_references(
    subject_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List reference documents shared by the teacher for an enrolled subject.
    Only returns documents where is_public=True.
    """
    # Verify enrollment
    enrollment = await db.execute(
        select(Enrollment).where(
            Enrollment.student_id == current_user.id,
            Enrollment.subject_id == subject_id,
            Enrollment.status == "approved",
        )
    )
    if not enrollment.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not enrolled in this subject")

    # Get public reference documents for this subject
    result = await db.execute(
        select(Document).where(
            Document.subject_id == subject_id,
            Document.is_public == True,
            Document.index_type.in_(["reference_book", "template_paper"]),
            Document.processing_status == "completed",
        ).order_by(Document.upload_timestamp.desc())
    )
    docs = result.scalars().all()

    doc_responses = [
        {
            "id": str(doc.id),
            "filename": doc.filename,
            "file_size_bytes": doc.file_size_bytes,
            "mime_type": doc.mime_type,
            "index_type": doc.index_type,
            "subject_id": str(doc.subject_id) if doc.subject_id else None,
            "processing_status": doc.processing_status,
            "upload_timestamp": doc.upload_timestamp.isoformat() if doc.upload_timestamp else None,
        }
        for doc in docs
    ]

    return {
        "reference_books": [d for d in doc_responses if d["index_type"] == "reference_book"],
        "template_papers": [d for d in doc_responses if d["index_type"] == "template_paper"],
        "reference_questions": [],
    }



@router.post("/enroll", response_model=EnrollmentResponse)
async def enroll_in_subject(
    data: EnrollmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Request enrollment in a subject (creates pending enrollment)."""
    service = GamificationService(db)
    try:
        enrollment = await service.enroll_student(current_user.id, data.subject_id)
        # Get subject info for response
        all_enrollments = await service.get_all_enrollments(current_user.id)
        for e in all_enrollments:
            if e["id"] == enrollment.id:
                return e
        return enrollment
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/enrollments", response_model=list[EnrollmentResponse])
async def list_enrollments(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List current student's approved enrollments."""
    service = GamificationService(db)
    return await service.get_enrollments(current_user.id)


@router.get("/enrollments/all", response_model=list[EnrollmentResponse])
async def list_all_enrollments(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all enrollments (including pending/rejected)."""
    service = GamificationService(db)
    return await service.get_all_enrollments(current_user.id)


# --- Lessons ---

@router.get("/lesson/{subject_id}", response_model=LessonResponse)
async def get_lesson(
    subject_id: UUID,
    topic_id: Optional[UUID] = Query(None),
    count: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get a lesson (set of questions) for a subject/topic. Requires enrollment."""
    service = GamificationService(db)
    # Verify enrollment
    enrollments = await service.get_enrollments(current_user.id)
    if not any(e["subject_id"] == subject_id for e in enrollments):
        raise HTTPException(status_code=403, detail="Not enrolled in this subject")
    return await service.get_lesson_questions(current_user.id, subject_id, topic_id, count)


@router.post("/lesson/submit", response_model=LessonResult)
async def submit_lesson(
    submission: LessonSubmission,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Submit lesson answers and get results with XP/streak updates."""
    service = GamificationService(db)
    # Verify enrollment
    enrollments = await service.get_enrollments(current_user.id)
    if not any(e["subject_id"] == submission.subject_id for e in enrollments):
        raise HTTPException(status_code=403, detail="Not enrolled in this subject")
    try:
        return await service.submit_lesson(current_user.id, submission.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- Progress ---

@router.get("/progress/{subject_id}", response_model=list[StudentProgressResponse])
async def get_subject_progress(
    subject_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get student progress for all topics in a subject."""
    service = GamificationService(db)
    return await service.get_subject_progress(current_user.id, subject_id)


# --- Profile & Gamification ---

@router.get("/profile", response_model=GamificationProfile)
async def get_gamification_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get gamification profile (XP, streaks, badges, stats)."""
    service = GamificationService(db)
    try:
        return await service.get_profile(current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/leaderboard", response_model=LeaderboardResponse)
async def get_leaderboard(
    limit: int = Query(20, ge=1, le=100),
    subject_id: Optional[UUID] = Query(None, description="Filter leaderboard to students enrolled in this subject"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get XP leaderboard. Optionally filter by subject for class-wise ranking."""
    service = GamificationService(db)
    return await service.get_leaderboard(current_user.id, limit, subject_id)


# --- Test History ---

@router.get("/history", response_model=list[TestHistoryResponse])
async def get_test_history(
    subject_id: Optional[UUID] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get test/lesson history."""
    service = GamificationService(db)
    return await service.get_test_history(current_user.id, subject_id, limit)


# --- Daily Activity ---

@router.get("/activity", response_model=list[DailyActivityResponse])
async def get_daily_activity(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get daily activity for streak tracking."""
    service = GamificationService(db)
    return await service.get_daily_activity(current_user.id, days)


# --- Hearts ---

@router.get("/hearts")
async def get_hearts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get current heart count."""
    service = GamificationService(db)
    hearts = await service.get_hearts(current_user.id)
    return {"hearts": hearts, "max_hearts": 5}
