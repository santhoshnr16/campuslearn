"""
Subject and Topic API endpoints.
"""

import os
import io
import logging
from typing import Optional, List
import uuid
import fitz  # PyMuPDF

from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.models.subject import Subject, Topic
from app.models.question import Question
from app.models.user import User
from app.models.gamification import Enrollment
from app.schemas.subject import (
    SubjectCreate,
    SubjectUpdate,
    SubjectResponse,
    SubjectListResponse,
    SubjectDetailResponse,
    TopicCreate,
    TopicUpdate,
    TopicResponse,
    TopicListResponse,
)
from app.schemas.gamification import (
    PendingEnrollmentResponse,
    EnrollmentActionRequest,
)
from app.api.v1.deps import get_current_user
from app.services.llm_service import LLMService
from app.services.gamification_service import GamificationService

logger = logging.getLogger(__name__)
router = APIRouter()


# ============== Subject Endpoints ==============

@router.post("", response_model=SubjectResponse, status_code=status.HTTP_201_CREATED)
async def create_subject(
    subject_data: SubjectCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new subject."""
    subject = Subject(
        user_id=current_user.id,
        name=subject_data.name,
        code=subject_data.code,
        description=subject_data.description,
        learning_outcomes=(
            {"outcomes": [lo.model_dump() for lo in subject_data.learning_outcomes]}
            if subject_data.learning_outcomes else None
        ),
        course_outcomes=(
            {"outcomes": [co.model_dump() for co in subject_data.course_outcomes]}
            if subject_data.course_outcomes else None
        ),
    )
    db.add(subject)
    await db.commit()
    await db.refresh(subject)
    return SubjectResponse.model_validate(subject)


@router.get("", response_model=SubjectListResponse)
async def list_subjects(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None, description="Search by name or code"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all subjects for the current user."""
    query = select(Subject).where(Subject.user_id == current_user.id)
    
    if search:
        query = query.where(
            (Subject.name.ilike(f"%{search}%")) | (Subject.code.ilike(f"%{search}%"))
        )
    
    # Count total
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()
    
    # Paginate
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit).order_by(Subject.name)
    
    result = await db.execute(query)
    subjects = result.scalars().all()
    
    return SubjectListResponse(
        subjects=[SubjectResponse.model_validate(s) for s in subjects],
        pagination={
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit,
        }
    )


@router.get("/{subject_id}", response_model=SubjectDetailResponse)
async def get_subject(
    subject_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific subject with its topics."""
    result = await db.execute(
        select(Subject)
        .options(selectinload(Subject.topics))
        .where(
            Subject.id == subject_id,
            Subject.user_id == current_user.id,
        )
    )
    subject = result.scalar_one_or_none()
    
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subject not found",
        )
    
    # Compute live question counts per topic (only non-archived)
    topic_counts_result = await db.execute(
        select(Question.topic_id, func.count(Question.id))
        .where(
            Question.topic_id.isnot(None),
            Question.is_archived == False,
            Question.vetting_status == "approved",
        )
        .group_by(Question.topic_id)
    )
    topic_counts = dict(topic_counts_result.all())

    sorted_topics = sorted(subject.topics, key=lambda x: x.order_index)
    topic_responses = []
    for t in sorted_topics:
        tr = TopicResponse.model_validate(t)
        tr.total_questions = topic_counts.get(t.id, 0)
        topic_responses.append(tr)

    return SubjectDetailResponse(
        **SubjectResponse.model_validate(subject).model_dump(),
        topics=topic_responses
    )


@router.put("/{subject_id}", response_model=SubjectResponse)
async def update_subject(
    subject_id: uuid.UUID,
    subject_data: SubjectUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a subject."""
    result = await db.execute(
        select(Subject).where(
            Subject.id == subject_id,
            Subject.user_id == current_user.id,
        )
    )
    subject = result.scalar_one_or_none()
    
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subject not found",
        )
    
    update_data = subject_data.model_dump(exclude_unset=True)
    
    if "learning_outcomes" in update_data and update_data["learning_outcomes"]:
        update_data["learning_outcomes"] = {"outcomes": [lo.model_dump() for lo in subject_data.learning_outcomes]}
    if "course_outcomes" in update_data and update_data["course_outcomes"]:
        update_data["course_outcomes"] = {"outcomes": [co.model_dump() for co in subject_data.course_outcomes]}
    
    for field, value in update_data.items():
        setattr(subject, field, value)
    
    await db.commit()
    await db.refresh(subject)
    return SubjectResponse.model_validate(subject)


@router.delete("/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_subject(
    subject_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a subject and all its topics."""
    result = await db.execute(
        select(Subject).where(
            Subject.id == subject_id,
            Subject.user_id == current_user.id,
        )
    )
    subject = result.scalar_one_or_none()
    
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subject not found",
        )
    
    await db.delete(subject)
    await db.commit()


# ============== Enrollment Management (Teacher) ==============

@router.get("/enrollments/all", response_model=list[PendingEnrollmentResponse])
async def list_all_enrollments(
    status_filter: Optional[str] = Query(None, description="Filter: pending, approved, rejected"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all enrollment requests across all teacher's subjects."""
    service = GamificationService(db)
    filter_status = status_filter or "pending"
    
    # Reuse get_pending_enrollments but with extended status support
    query = (
        select(Enrollment, User, Subject.name, Subject.code)
        .join(Subject, Enrollment.subject_id == Subject.id)
        .join(User, Enrollment.student_id == User.id)
        .where(Subject.user_id == current_user.id)
    )
    if filter_status != "all":
        query = query.where(Enrollment.status == filter_status)
    query = query.order_by(Enrollment.enrolled_at.desc())
    
    result = await db.execute(query)
    rows = result.all()
    return [
        {
            "id": e.id,
            "student_id": e.student_id,
            "student_name": u.full_name or u.username or "Unknown",
            "student_email": u.email,
            "subject_id": e.subject_id,
            "subject_name": subj_name,
            "enrolled_at": e.enrolled_at,
            "status": e.status,
        }
        for e, u, subj_name, _code in rows
    ]

@router.get("/{subject_id}/enrollments", response_model=list[PendingEnrollmentResponse])
async def list_subject_enrollments(
    subject_id: uuid.UUID,
    status_filter: Optional[str] = Query(None, description="Filter by status: pending, approved, rejected"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List enrollment requests for a subject (teacher only)."""
    # Verify subject ownership
    result = await db.execute(
        select(Subject).where(
            Subject.id == subject_id,
            Subject.user_id == current_user.id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Subject not found")

    service = GamificationService(db)
    if status_filter == "pending" or status_filter is None:
        return await service.get_pending_enrollments(current_user.id, subject_id)
    # For other statuses, return a filtered list
    return await service.get_pending_enrollments(current_user.id, subject_id)


@router.post("/{subject_id}/enrollments/{enrollment_id}/approve")
async def approve_enrollment(
    subject_id: uuid.UUID,
    enrollment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Approve a pending enrollment request (teacher only)."""
    service = GamificationService(db)
    try:
        enrollment = await service.approve_enrollment(enrollment_id, current_user.id)
        return {"message": "Enrollment approved", "enrollment_id": str(enrollment.id), "status": enrollment.status}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{subject_id}/enrollments/{enrollment_id}/reject")
async def reject_enrollment(
    subject_id: uuid.UUID,
    enrollment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reject a pending enrollment request (teacher only)."""
    service = GamificationService(db)
    try:
        enrollment = await service.reject_enrollment(enrollment_id, current_user.id)
        return {"message": "Enrollment rejected", "enrollment_id": str(enrollment.id), "status": enrollment.status}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============== Topic Endpoints ==============

@router.post("/{subject_id}/topics", response_model=TopicResponse, status_code=status.HTTP_201_CREATED)
async def create_topic(
    subject_id: uuid.UUID,
    topic_data: TopicCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new topic in a subject."""
    # Verify subject ownership
    result = await db.execute(
        select(Subject).where(
            Subject.id == subject_id,
            Subject.user_id == current_user.id,
        )
    )
    subject = result.scalar_one_or_none()
    
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subject not found",
        )
    
    topic = Topic(
        subject_id=subject_id,
        name=topic_data.name,
        description=topic_data.description,
        order_index=topic_data.order_index,
    )
    db.add(topic)
    
    # Update subject topic count
    subject.total_topics += 1
    
    await db.commit()
    await db.refresh(topic)
    return TopicResponse.model_validate(topic)


@router.get("/{subject_id}/topics", response_model=TopicListResponse)
async def list_topics(
    subject_id: uuid.UUID,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all topics for a subject."""
    # Verify subject ownership
    result = await db.execute(
        select(Subject).where(
            Subject.id == subject_id,
            Subject.user_id == current_user.id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subject not found",
        )
    
    query = select(Topic).where(Topic.subject_id == subject_id)
    
    # Count total
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()
    
    # Paginate
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit).order_by(Topic.order_index)
    
    result = await db.execute(query)
    topics = result.scalars().all()
    
    # Compute live question counts per topic (only non-archived)
    topic_ids = [t.id for t in topics]
    if topic_ids:
        topic_counts_result = await db.execute(
            select(Question.topic_id, func.count(Question.id))
            .where(
                Question.topic_id.in_(topic_ids),
                Question.is_archived == False,
            Question.vetting_status == "approved",
            )
            .group_by(Question.topic_id)
        )
        topic_counts = dict(topic_counts_result.all())
    else:
        topic_counts = {}

    topic_responses = []
    for t in topics:
        tr = TopicResponse.model_validate(t)
        tr.total_questions = topic_counts.get(t.id, 0)
        topic_responses.append(tr)

    return TopicListResponse(
        topics=topic_responses,
        pagination={
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit,
        }
    )


@router.put("/{subject_id}/topics/{topic_id}", response_model=TopicResponse)
async def update_topic(
    subject_id: uuid.UUID,
    topic_id: uuid.UUID,
    topic_data: TopicUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a topic."""
    # Verify subject ownership
    result = await db.execute(
        select(Subject).where(
            Subject.id == subject_id,
            Subject.user_id == current_user.id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subject not found",
        )
    
    result = await db.execute(
        select(Topic).where(
            Topic.id == topic_id,
            Topic.subject_id == subject_id,
        )
    )
    topic = result.scalar_one_or_none()
    
    if not topic:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Topic not found",
        )
    
    update_data = topic_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(topic, field, value)
    
    await db.commit()
    await db.refresh(topic)
    return TopicResponse.model_validate(topic)


@router.delete("/{subject_id}/topics/{topic_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_topic(
    subject_id: uuid.UUID,
    topic_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a topic."""
    # Verify subject ownership
    result = await db.execute(
        select(Subject).where(
            Subject.id == subject_id,
            Subject.user_id == current_user.id,
        )
    )
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subject not found",
        )
    
    result = await db.execute(
        select(Topic).where(
            Topic.id == topic_id,
            Topic.subject_id == subject_id,
        )
    )
    topic = result.scalar_one_or_none()
    
    if not topic:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Topic not found",
        )
    
    await db.delete(topic)
    subject.total_topics = max(0, subject.total_topics - 1)
    await db.commit()


@router.post("/{subject_id}/topics/{topic_id}/upload-syllabus", response_model=TopicResponse)
async def upload_topic_syllabus(
    subject_id: uuid.UUID,
    topic_id: uuid.UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a document (PDF, DOCX, TXT) and extract its content as syllabus for the topic.
    The extracted text will be saved to the topic's syllabus_content field.
    """
    # Verify subject ownership
    result = await db.execute(
        select(Subject).where(
            Subject.id == subject_id,
            Subject.user_id == current_user.id,
        )
    )
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subject not found",
        )
    
    # Get topic
    result = await db.execute(
        select(Topic).where(
            Topic.id == topic_id,
            Topic.subject_id == subject_id,
        )
    )
    topic = result.scalar_one_or_none()
    
    if not topic:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Topic not found",
        )
    
    # Validate file extension
    filename = file.filename or "document"
    ext = os.path.splitext(filename)[1].lower()
    
    allowed_extensions = [".pdf", ".txt", ".docx"]
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}",
        )
    
    # Read file content
    content = await file.read()
    
    # Validate file size (10MB limit)
    max_size_mb = 10
    if len(content) > max_size_mb * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size: {max_size_mb}MB",
        )
    
    # Extract text based on file type
    try:
        text_content = await _extract_text_from_file(content, ext)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to extract text from file: {str(e)}",
        )
    
    if not text_content.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No text content could be extracted from the file",
        )
    
    # Update topic with extracted content
    topic.syllabus_content = text_content
    topic.has_syllabus = True
    
    # Update subject syllabus coverage
    total_topics_result = await db.execute(
        select(func.count()).where(Topic.subject_id == subject_id)
    )
    total_topics = total_topics_result.scalar_one()
    
    topics_with_syllabus_result = await db.execute(
        select(func.count()).where(
            Topic.subject_id == subject_id,
            Topic.has_syllabus == True,
        )
    )
    topics_with_syllabus = topics_with_syllabus_result.scalar_one()
    
    if total_topics > 0:
        subject.syllabus_coverage = (topics_with_syllabus / total_topics) * 100
    
    await db.commit()
    await db.refresh(topic)
    
    return TopicResponse.model_validate(topic)


async def _extract_text_from_file(content: bytes, extension: str) -> str:
    """Extract text from file content based on file type."""
    
    if extension == ".pdf":
        text_parts = []
        with fitz.open(stream=content, filetype="pdf") as doc:
            for page in doc:
                text_parts.append(page.get_text())
        return "\n\n".join(text_parts)
    
    elif extension == ".txt":
        return content.decode("utf-8", errors="ignore")
    
    elif extension == ".docx":
        from docx import Document
        doc = Document(io.BytesIO(content))
        text_parts = []
        for paragraph in doc.paragraphs:
            if paragraph.text.strip():
                text_parts.append(paragraph.text)
        return "\n\n".join(text_parts)
    
    return ""


async def _extract_chapters_with_llm(text_content: str, subject_name: str, subject_code: str) -> List[dict]:
    """
    Use LLM to intelligently extract chapters/topics from syllabus text.
    Returns a list of dicts with 'name', 'description', and optionally 'syllabus_content'.
    """
    llm_service = LLMService()
    
    # Truncate text if too long (LLMs have context limits)
    max_chars = 15000
    truncated_text = text_content[:max_chars] if len(text_content) > max_chars else text_content
    
    system_prompt = """You are an expert curriculum analyzer. Your task is to extract chapters/topics/units from a syllabus document.

For each chapter you identify:
1. Extract the chapter/topic/unit name
2. Extract or summarize a brief description
3. Include the relevant syllabus content for that chapter

Return your response as a valid JSON array of objects with the following structure:
[
  {
    "name": "Chapter 1: Introduction to Subject",
    "description": "Brief overview of the chapter content",
    "syllabus_content": "Detailed syllabus content for this chapter"
  }
]

Guidelines:
- Extract ALL chapters/units/modules mentioned in the syllabus
- Maintain the original order from the syllabus
- Include chapter numbers if present (e.g., "Chapter 1:", "Unit 1:", "Module 1:")
- Keep the syllabus_content detailed and accurate
- If no clear chapter divisions exist, group related topics logically
- Return ONLY the JSON array, no other text"""

    prompt = f"""Analyze the following syllabus for the subject "{subject_name}" (Code: {subject_code}) and extract all chapters/topics/units:

SYLLABUS CONTENT:
{truncated_text}

Extract all chapters with their names, descriptions, and content. Return as a JSON array."""

    try:
        result = await llm_service.generate_json(
            prompt=prompt,
            system_prompt=system_prompt,
            temperature=0.2,  # Low temperature for more deterministic extraction
        )
        
        # Handle both array and object with 'chapters' key
        if isinstance(result, list):
            chapters = result
        elif isinstance(result, dict) and 'chapters' in result:
            chapters = result['chapters']
        else:
            # Try to find an array in the result
            for key, value in result.items():
                if isinstance(value, list):
                    chapters = value
                    break
            else:
                chapters = []
        
        # Validate and clean chapters
        validated_chapters = []
        for chapter in chapters:
            if isinstance(chapter, dict) and 'name' in chapter:
                validated_chapters.append({
                    'name': str(chapter.get('name', 'Untitled Chapter'))[:255],
                    'description': str(chapter.get('description', ''))[:1000] if chapter.get('description') else None,
                    'syllabus_content': str(chapter.get('syllabus_content', '')) if chapter.get('syllabus_content') else None,
                })
        
        return validated_chapters
        
    except Exception as e:
        logger.error(f"LLM chapter extraction failed: {e}")
        raise


@router.post("/{subject_id}/extract-chapters")
async def extract_chapters_from_syllabus(
    subject_id: uuid.UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a syllabus PDF/DOCX/TXT and use AI to automatically extract and create chapters.
    
    This endpoint:
    1. Extracts text from the uploaded document
    2. Uses LLM to identify chapters/topics from the syllabus
    3. Creates Topic entries for each identified chapter
    4. Returns the list of created topics
    """
    # Verify subject ownership
    result = await db.execute(
        select(Subject).where(
            Subject.id == subject_id,
            Subject.user_id == current_user.id,
        )
    )
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subject not found",
        )
    
    # Validate file extension
    filename = file.filename or "document"
    ext = os.path.splitext(filename)[1].lower()
    
    allowed_extensions = [".pdf", ".txt", ".docx"]
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}",
        )
    
    # Read file content
    content = await file.read()
    
    # Validate file size (15MB limit for syllabus)
    max_size_mb = 15
    if len(content) > max_size_mb * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size: {max_size_mb}MB",
        )
    
    # Extract text from document
    try:
        text_content = await _extract_text_from_file(content, ext)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to extract text from file: {str(e)}",
        )
    
    if not text_content.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No text content could be extracted from the file",
        )
    
    # Use LLM to extract chapters
    try:
        chapters = await _extract_chapters_with_llm(
            text_content=text_content,
            subject_name=subject.name,
            subject_code=subject.code,
        )
    except Exception as e:
        logger.error(f"LLM extraction error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI failed to extract chapters: {str(e)}",
        )
    
    if not chapters:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No chapters could be identified in the document. Please ensure the file contains a valid syllabus structure.",
        )
    
    # Get current max order_index for existing topics
    existing_topics_result = await db.execute(
        select(func.max(Topic.order_index)).where(Topic.subject_id == subject_id)
    )
    max_order = existing_topics_result.scalar_one() or -1
    
    # Create topics for each extracted chapter
    created_topics = []
    for idx, chapter in enumerate(chapters):
        topic = Topic(
            subject_id=subject_id,
            name=chapter['name'],
            description=chapter.get('description'),
            order_index=max_order + 1 + idx,
            has_syllabus=bool(chapter.get('syllabus_content')),
            syllabus_content=chapter.get('syllabus_content'),
        )
        db.add(topic)
        created_topics.append(topic)
    
    # Update subject stats
    subject.total_topics += len(created_topics)
    
    # Recalculate syllabus coverage
    total_topics_result = await db.execute(
        select(func.count()).where(Topic.subject_id == subject_id)
    )
    # Add the new topics we just created (they haven't been committed yet)
    total_topics = total_topics_result.scalar_one() + len(created_topics)
    
    topics_with_syllabus_count = sum(1 for t in created_topics if t.has_syllabus)
    existing_with_syllabus_result = await db.execute(
        select(func.count()).where(
            Topic.subject_id == subject_id,
            Topic.has_syllabus == True,
        )
    )
    total_with_syllabus = existing_with_syllabus_result.scalar_one() + topics_with_syllabus_count
    
    if total_topics > 0:
        subject.syllabus_coverage = int((total_with_syllabus / total_topics) * 100)
    
    await db.commit()
    
    # Refresh topics to get their IDs
    for topic in created_topics:
        await db.refresh(topic)
    
    return {
        "message": f"Successfully extracted {len(created_topics)} chapters from syllabus",
        "chapters_created": len(created_topics),
        "topics": [TopicResponse.model_validate(t) for t in created_topics],
    }


@router.post("/{subject_id}/generate-learning-content")
async def generate_learning_content(
    subject_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate learning content (.md) for ALL topics using LLM + RAG.
    Uses hybrid_search + embeddings + cosine similarity from reference documents.
    Processes topics sequentially.
    """
    import logging
    logger = logging.getLogger(__name__)

    # Verify subject ownership
    result = await db.execute(
        select(Subject).where(
            Subject.id == subject_id,
            Subject.user_id == current_user.id,
        )
    )
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subject not found",
        )

    # Get all topics
    result = await db.execute(
        select(Topic)
        .where(Topic.subject_id == subject_id)
        .order_by(Topic.order_index)
    )
    topics = result.scalars().all()

    if not topics:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No topics found. Add topics before generating content.",
        )

    # Gather reference document IDs for RAG
    from app.models.document import Document
    ref_result = await db.execute(
        select(Document.id).where(
            Document.subject_id == subject_id,
            Document.index_type.in_(["primary", "reference_book", "template_paper"]),
            Document.processing_status == "completed",
        )
    )
    doc_ids = [row[0] for row in ref_result.all()]

    # Initialize services for RAG
    from app.services.llm_service import LLMService
    from app.services.document_service import DocumentService
    from app.services.embedding_service import EmbeddingService

    llm = LLMService()
    doc_service = DocumentService(db)
    embedding_service = EmbeddingService()

    topic_names = [t.name for t in topics]
    topic_list_str = "\n".join(f"{i+1}. {name}" for i, name in enumerate(topic_names))

    system_prompt = f"""You are an expert educational content writer creating comprehensive learning materials for a university-level subject.

Subject: {subject.name} ({subject.code})
All topics: {topic_list_str}

Write in clear, well-structured Markdown format suitable for students to study from.
Include:
- Key concepts and definitions
- Important formulas or principles (if applicable)
- Examples where helpful
- Summary points at the end

Write content that is educational, accurate, and student-friendly.
Do NOT mention source documents or references. Write as standalone educational content."""

    generated_topics = []
    errors = []

    # Generate content for each topic sequentially using RAG
    for topic in topics:
        if topic.has_syllabus and topic.syllabus_content and len(topic.syllabus_content) > 100:
            generated_topics.append({
                "topic_id": str(topic.id), "topic_name": topic.name,
                "status": "skipped", "reason": "Already has content",
            })
            continue

        # --- RAG: Retrieve relevant context using hybrid search ---
        rag_context = ""
        if doc_ids:
            try:
                query = f"{topic.name} {topic.description or ''} {subject.name}"
                query_embedding = await embedding_service.get_embedding(query)
                relevant_chunks = await doc_service.hybrid_search_multi_document(
                    document_ids=doc_ids,
                    query=query,
                    query_embedding=query_embedding,
                    top_k=8,
                    alpha=0.6,
                )
                if relevant_chunks:
                    rag_context = "\n\n".join([
                        f"[Source: {c.document.filename if c.document else 'unknown'}, Page {c.page_number or '?'}]\n{c.chunk_text}"
                        for c in relevant_chunks
                    ])
            except Exception as e:
                logger.warning(f"RAG retrieval failed for topic {topic.name}: {e}")

        prompt = f"""Generate comprehensive learning content for this topic:

**Topic: {topic.name}**
{f'Description: {topic.description}' if topic.description else ''}

{f'--- Relevant Reference Material ---{chr(10)}{rag_context}' if rag_context else ''}

Write a comprehensive study guide for "{topic.name}" in Markdown format.
Include headings, bullet points, and clear explanations.
The content should be 800-1500 words, thorough enough for a student to learn the topic."""

        try:
            content = await llm.generate(
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=0.5,
                max_tokens=4000,
            )
            topic.syllabus_content = content.strip()
            topic.has_syllabus = True
            generated_topics.append({
                "topic_id": str(topic.id), "topic_name": topic.name,
                "status": "generated", "content_length": len(content),
            })
        except Exception as e:
            logger.error(f"Failed to generate content for topic {topic.name}: {e}")
            errors.append({"topic_id": str(topic.id), "topic_name": topic.name, "error": str(e)})

    # Update syllabus coverage
    topics_with_syllabus = sum(1 for t in topics if t.has_syllabus)
    if len(topics) > 0:
        subject.syllabus_coverage = int((topics_with_syllabus / len(topics)) * 100)

    await db.commit()

    return {
        "message": f"Generated content for {len([t for t in generated_topics if t['status'] == 'generated'])} topics",
        "generated": generated_topics,
        "errors": errors,
        "syllabus_coverage": subject.syllabus_coverage,
    }


@router.post("/{subject_id}/topics/{topic_id}/generate-content")
async def generate_topic_content(
    subject_id: uuid.UUID,
    topic_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate learning content (.md) for a SINGLE topic using LLM + RAG pipeline.
    Uses hybrid_search + embeddings + cosine similarity from reference documents.
    """
    import logging
    logger = logging.getLogger(__name__)

    # Verify subject ownership
    result = await db.execute(
        select(Subject).where(Subject.id == subject_id, Subject.user_id == current_user.id)
    )
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subject not found")

    # Get the topic
    result = await db.execute(
        select(Topic).where(Topic.id == topic_id, Topic.subject_id == subject_id)
    )
    topic = result.scalar_one_or_none()
    if not topic:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found")

    # Get all topic names for context
    all_topics_result = await db.execute(
        select(Topic.name).where(Topic.subject_id == subject_id).order_by(Topic.order_index)
    )
    all_topic_names = [row[0] for row in all_topics_result.all()]
    topic_list_str = "\n".join(f"{i+1}. {name}" for i, name in enumerate(all_topic_names))

    # Gather reference document IDs for RAG
    from app.models.document import Document
    ref_result = await db.execute(
        select(Document.id).where(
            Document.subject_id == subject_id,
            Document.index_type.in_(["primary", "reference_book", "template_paper"]),
            Document.processing_status == "completed",
        )
    )
    doc_ids = [row[0] for row in ref_result.all()]

    # Initialize services
    from app.services.llm_service import LLMService
    from app.services.document_service import DocumentService
    from app.services.embedding_service import EmbeddingService

    llm = LLMService()
    doc_service = DocumentService(db)
    embedding_service = EmbeddingService()

    # --- RAG: Retrieve relevant context ---
    rag_context = ""
    if doc_ids:
        try:
            query = f"{topic.name} {topic.description or ''} {subject.name}"
            query_embedding = await embedding_service.get_embedding(query)
            relevant_chunks = await doc_service.hybrid_search_multi_document(
                document_ids=doc_ids,
                query=query,
                query_embedding=query_embedding,
                top_k=10,
                alpha=0.6,
            )
            if relevant_chunks:
                rag_context = "\n\n".join([
                    f"[Source: {c.document.filename if c.document else 'unknown'}, Page {c.page_number or '?'}]\n{c.chunk_text}"
                    for c in relevant_chunks
                ])
        except Exception as e:
            logger.warning(f"RAG retrieval failed for topic {topic.name}: {e}")

    system_prompt = f"""You are an expert educational content writer. Create comprehensive, well-structured learning materials in Markdown format.

Subject: {subject.name} ({subject.code})
All topics: {topic_list_str}

Guidelines:
- Use clear headings (## and ###), bullet points, and numbered lists
- Include key concepts, definitions, formulas (if applicable), and examples
- Add a summary section at the end
- Write 800-1500 words of thorough, student-friendly educational content
- Do NOT mention source documents or references"""

    prompt = f"""Generate comprehensive learning content for this topic:

**Topic: {topic.name}**
{f'Description: {topic.description}' if topic.description else ''}

{f'--- Relevant Reference Material ---{chr(10)}{rag_context}' if rag_context else ''}

Write a comprehensive study guide for "{topic.name}" in Markdown format."""

    try:
        content = await llm.generate(
            prompt=prompt,
            system_prompt=system_prompt,
            temperature=0.5,
            max_tokens=4000,
        )
        topic.syllabus_content = content.strip()
        topic.has_syllabus = True

        # Update syllabus coverage
        total_topics_result = await db.execute(
            select(func.count()).where(Topic.subject_id == subject_id)
        )
        total_topics = total_topics_result.scalar_one()
        with_syllabus_result = await db.execute(
            select(func.count()).where(Topic.subject_id == subject_id, Topic.has_syllabus == True)
        )
        with_syllabus = with_syllabus_result.scalar_one()
        if total_topics > 0:
            subject.syllabus_coverage = int((with_syllabus / total_topics) * 100)

        await db.commit()

        return {
            "topic_id": str(topic.id),
            "topic_name": topic.name,
            "status": "generated",
            "content_length": len(content),
            "content_preview": content[:300],
            "syllabus_coverage": subject.syllabus_coverage,
        }
    except Exception as e:
        logger.error(f"Failed to generate content for topic {topic.name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Content generation failed: {str(e)}",
        )