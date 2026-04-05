"""
Test API endpoints for teacher-created assessments.
"""

from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.deps import get_current_active_user
from app.models.user import User
from app.services.test_service import TestService
from app.schemas.test import (
    TestCreate,
    TestUpdate,
    TestResponse,
    TestDetailResponse,
    TestQuestionUpdate,
    TestQuestionResponse,
    TestSubmissionCreate,
    TestSubmissionResponse,
    TestPerformanceResponse,
    GenerateTestRequest,
)

router = APIRouter()


def require_teacher(user: User):
    """Ensure user is a teacher or admin."""
    if user.role not in ("teacher", "admin"):
        raise HTTPException(status_code=403, detail="Only teachers can access this resource")


# ========================
# Teacher: Test CRUD
# ========================

@router.post("", response_model=TestResponse)
async def create_test(
    data: TestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new test (draft)."""
    require_teacher(current_user)
    service = TestService(db)
    # Convert difficulty_config models to dicts
    difficulty_config = None
    if data.difficulty_config:
        difficulty_config = {
            k: v.model_dump() for k, v in data.difficulty_config.items()
        }
    topic_config = None
    if data.topic_config:
        topic_config = [t.model_dump(mode="json") for t in data.topic_config]

    test = await service.create_test(current_user.id, {
        "subject_id": data.subject_id,
        "title": data.title,
        "description": data.description,
        "instructions": data.instructions,
        "generation_type": data.generation_type,
        "difficulty_config": difficulty_config,
        "topic_config": topic_config,
        "duration_minutes": data.duration_minutes,
    })
    return TestResponse(
        id=test.id,
        teacher_id=test.teacher_id,
        subject_id=test.subject_id,
        title=test.title,
        description=test.description,
        instructions=test.instructions,
        generation_type=test.generation_type,
        difficulty_config=test.difficulty_config,
        topic_config=test.topic_config,
        total_questions=test.total_questions,
        total_marks=test.total_marks,
        duration_minutes=test.duration_minutes,
        status=test.status,
        published_at=test.published_at,
        unpublished_at=test.unpublished_at,
        created_at=test.created_at,
        updated_at=test.updated_at,
    )


@router.get("", response_model=list[TestResponse])
async def list_tests(
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List teacher's tests."""
    require_teacher(current_user)
    service = TestService(db)
    tests = await service.list_tests(current_user.id, status=status)
    return tests


@router.get("/{test_id}", response_model=TestDetailResponse)
async def get_test(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get test details with questions."""
    require_teacher(current_user)
    service = TestService(db)
    test = await service.get_test(test_id, current_user.id)
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    questions = await service.get_test_questions(test_id)
    
    # Get submissions count
    submissions_count = await service.get_submissions_count(test_id)

    return TestDetailResponse(
        id=test.id,
        teacher_id=test.teacher_id,
        subject_id=test.subject_id,
        title=test.title,
        description=test.description,
        instructions=test.instructions,
        generation_type=test.generation_type,
        difficulty_config=test.difficulty_config,
        topic_config=test.topic_config,
        total_questions=test.total_questions,
        total_marks=test.total_marks,
        duration_minutes=test.duration_minutes,
        status=test.status,
        published_at=test.published_at,
        unpublished_at=test.unpublished_at,
        created_at=test.created_at,
        updated_at=test.updated_at,
        questions=questions,
        submissions_count=submissions_count,
    )


@router.put("/{test_id}", response_model=TestResponse)
async def update_test(
    test_id: UUID,
    data: TestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update test details."""
    require_teacher(current_user)
    service = TestService(db)
    update_data = data.model_dump(exclude_unset=True)
    # Convert nested models
    if "difficulty_config" in update_data and update_data["difficulty_config"]:
        update_data["difficulty_config"] = {
            k: v.model_dump() if hasattr(v, 'model_dump') else v
            for k, v in update_data["difficulty_config"].items()
        }
    if "topic_config" in update_data and update_data["topic_config"]:
        update_data["topic_config"] = [
            t.model_dump(mode="json") if hasattr(t, 'model_dump') else t
            for t in update_data["topic_config"]
        ]

    test = await service.update_test(test_id, current_user.id, update_data)
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    return test


@router.delete("/{test_id}")
async def delete_test(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete a test (draft/unpublished only)."""
    require_teacher(current_user)
    service = TestService(db)
    success = await service.delete_test(test_id, current_user.id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot delete this test")
    return {"status": "deleted"}


# ========================
# Teacher: Generate Questions
# ========================

@router.post("/{test_id}/generate")
async def generate_test_questions(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate/select questions for a test from approved pool."""
    require_teacher(current_user)
    service = TestService(db)
    try:
        result = await service.generate_test_questions(test_id, current_user.id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ========================
# Teacher: Publish/Unpublish
# ========================

@router.post("/{test_id}/publish")
async def publish_test(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Publish a test for students."""
    require_teacher(current_user)
    service = TestService(db)
    try:
        test = await service.publish_test(test_id, current_user.id)
        if not test:
            raise HTTPException(status_code=404, detail="Test not found")
        return {"status": "published", "published_at": test.published_at}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{test_id}/unpublish")
async def unpublish_test(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Unpublish a test."""
    require_teacher(current_user)
    service = TestService(db)
    test = await service.unpublish_test(test_id, current_user.id)
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    return {"status": "unpublished"}


# ========================
# Teacher: Question Management
# ========================

@router.put("/{test_id}/questions/{test_question_id}")
async def update_test_question(
    test_id: UUID,
    test_question_id: UUID,
    data: TestQuestionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update a question within a test."""
    require_teacher(current_user)
    service = TestService(db)
    result = await service.update_test_question(
        test_id, test_question_id, current_user.id, data.model_dump(exclude_unset=True)
    )
    if not result:
        raise HTTPException(status_code=404, detail="Question not found in test")
    return result


@router.delete("/{test_id}/questions/{test_question_id}")
async def remove_test_question(
    test_id: UUID,
    test_question_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Remove a question from a test."""
    require_teacher(current_user)
    service = TestService(db)
    success = await service.remove_test_question(test_id, test_question_id, current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"status": "removed"}


# ========================
# Teacher: Performance Analytics
# ========================

@router.get("/{test_id}/performance", response_model=TestPerformanceResponse)
async def get_test_performance(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get performance analytics for a test."""
    require_teacher(current_user)
    service = TestService(db)
    try:
        return await service.get_test_performance(test_id, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ========================
# Student: Available Tests
# ========================

@router.get("/student/available")
async def list_student_tests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List published tests for enrolled subjects."""
    service = TestService(db)
    return await service.get_published_tests_for_student(current_user.id)


@router.get("/student/{test_id}")
async def get_student_test(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get test details and questions for a student."""
    service = TestService(db)
    result = await service.get_test_for_student(test_id, current_user.id)
    if not result:
        raise HTTPException(status_code=404, detail="Test not available")
    return result


@router.post("/student/submit")
async def submit_student_test(
    data: TestSubmissionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Submit test answers."""
    service = TestService(db)
    try:
        return await service.submit_test(
            data.test_id,
            current_user.id,
            {
                "answers": [a.model_dump(mode="json") for a in data.answers],
                "total_time_seconds": data.total_time_seconds,
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
