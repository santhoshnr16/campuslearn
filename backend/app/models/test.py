"""
Test database models for teacher-created assessments.
"""

from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, Float, Boolean, DateTime, Text, ForeignKey, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
import uuid

from app.core.database import Base


class Test(Base):
    """Teacher-created test/assessment."""

    __tablename__ = "tests"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False
    )

    # Test info
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    instructions: Mapped[Optional[str]] = mapped_column(Text)

    # Generation configuration
    generation_type: Mapped[str] = mapped_column(
        String(30), default="subject_wise"
    )  # subject_wise, topic_wise, multi_topic
    
    # Configuration for difficulty levels
    # Format: {"easy": {"count": 5, "lo_mapping": ["LO1","LO2"]}, "medium": {"count": 3, "lo_mapping": ["LO3"]}, "hard": {"count": 2, "lo_mapping": ["LO4","LO5"]}}
    difficulty_config: Mapped[Optional[dict]] = mapped_column(JSONB)
    
    # Topic selections for topic_wise / multi_topic generation
    # Format: [{"topic_id": "...", "count": 5}, ...]
    topic_config: Mapped[Optional[list]] = mapped_column(JSONB)

    # Total counts
    total_questions: Mapped[int] = mapped_column(Integer, default=0)
    total_marks: Mapped[int] = mapped_column(Integer, default=0)
    duration_minutes: Mapped[Optional[int]] = mapped_column(Integer)

    # Publishing
    status: Mapped[str] = mapped_column(
        String(20), default="draft"
    )  # draft, published, unpublished, archived
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    unpublished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    teacher = relationship("User", back_populates="created_tests")
    subject = relationship("Subject", back_populates="tests")
    test_questions = relationship("TestQuestion", back_populates="test", cascade="all, delete-orphan")
    submissions = relationship("TestSubmission", back_populates="test", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Test {self.title}>"


class TestQuestion(Base):
    """Questions included in a test, with ordering and marks."""

    __tablename__ = "test_questions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    test_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tests.id", ondelete="CASCADE"), nullable=False
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
    )

    # Ordering and marks
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    marks: Mapped[int] = mapped_column(Integer, default=1)

    # Overrides (teacher can edit question text for this test)
    question_text_override: Mapped[Optional[str]] = mapped_column(Text)
    options_override: Mapped[Optional[List[str]]] = mapped_column(ARRAY(Text))
    correct_answer_override: Mapped[Optional[str]] = mapped_column(Text)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    test = relationship("Test", back_populates="test_questions")
    question = relationship("Question")

    __table_args__ = (
        UniqueConstraint("test_id", "question_id", name="uq_test_question"),
    )


class TestSubmission(Base):
    """Student submission for a published test."""

    __tablename__ = "test_submissions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    test_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tests.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # Scores
    score: Mapped[int] = mapped_column(Integer, default=0)
    total_marks: Mapped[int] = mapped_column(Integer, default=0)
    percentage: Mapped[float] = mapped_column(Float, default=0.0)

    # Details
    answers: Mapped[Optional[dict]] = mapped_column(JSONB)
    # Format: [{"question_id": "...", "selected_answer": "A", "is_correct": true, "marks_obtained": 1, "time_taken_seconds": 30}]

    time_taken_seconds: Mapped[Optional[int]] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(
        String(20), default="in_progress"
    )  # in_progress, submitted, graded

    # Timestamps
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Relationships
    test = relationship("Test", back_populates="submissions")
    student = relationship("User", back_populates="test_submissions")

    __table_args__ = (
        UniqueConstraint("test_id", "student_id", name="uq_test_student_submission"),
    )


class ExamSession(Base):
    """
    Streaming exam session for on-demand question generation.
    
    When a student starts a streaming exam, questions are generated one-at-a-time
    via SSE. This model tracks the session state, generated questions, and results.
    """

    __tablename__ = "exam_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    test_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tests.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False
    )

    # Session status: in_progress, completed, abandoned
    status: Mapped[str] = mapped_column(String(20), default="in_progress")
    
    # Question tracking
    total_questions_planned: Mapped[int] = mapped_column(Integer, default=10)
    total_questions_generated: Mapped[int] = mapped_column(Integer, default=0)
    
    # JSON array of generated question UUIDs in order
    question_ids: Mapped[list] = mapped_column(JSONB, default=list)
    
    # Student's answers: [{"question_id": "...", "selected_answer": "A", "is_correct": true}]
    answers: Mapped[Optional[dict]] = mapped_column(JSONB)
    
    # Scoring
    score: Mapped[Optional[int]] = mapped_column(Integer)
    total_marks: Mapped[Optional[int]] = mapped_column(Integer)

    # Timestamps
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Relationships
    test = relationship("Test")
    student = relationship("User")
    subject = relationship("Subject")
