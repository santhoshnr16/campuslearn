"""
Question and GenerationSession database models.
"""

from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, Float, Boolean, DateTime, Text, ForeignKey, CheckConstraint, func, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from pgvector.sqlalchemy import Vector
import uuid

from app.core.database import Base
from app.core.config import settings


class Question(Base):
    """Question model for generated questions."""
    
    __tablename__ = "questions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    document_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    subject_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True
    )
    topic_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("topics.id", ondelete="SET NULL"), nullable=True
    )
    session_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))
    
    # Question content
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_embedding = mapped_column(Vector(settings.EMBEDDING_DIMENSION))
    
    # Question classification
    question_type: Mapped[Optional[str]] = mapped_column(String(50))  # mcq, short_answer, long_answer, essay
    marks: Mapped[Optional[int]] = mapped_column(Integer)
    difficulty_level: Mapped[Optional[str]] = mapped_column(String(20))  # easy, medium, hard
    bloom_taxonomy_level: Mapped[Optional[str]] = mapped_column(String(30))  # remember, understand, apply, analyze, evaluate, create
    
    # Answer for MCQs
    correct_answer: Mapped[Optional[str]] = mapped_column(Text)
    options: Mapped[Optional[List[str]]] = mapped_column(JSON)
    explanation: Mapped[Optional[str]] = mapped_column(Text)  # Explanation for the answer
    
    # Context
    source_chunk_ids: Mapped[Optional[List[uuid.UUID]]] = mapped_column(JSON)
    topic_tags: Mapped[Optional[List[str]]] = mapped_column(JSON)
    
    # OBE Course Outcome mapping (CO1-CO5 with levels 1-3)
    course_outcome_mapping: Mapped[Optional[dict]] = mapped_column(JSON)  # {"CO1": 2, "CO3": 1}
    learning_outcome_id: Mapped[Optional[str]] = mapped_column(String(50))  # LO1, LO2, etc.
    
    # Vetting/Review status
    vetting_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending, approved, rejected
    vetted_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))
    vetted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    vetting_notes: Mapped[Optional[str]] = mapped_column(Text)
    
    # Quality scores
    answerability_score: Mapped[Optional[float]] = mapped_column(Float)
    specificity_score: Mapped[Optional[float]] = mapped_column(Float)
    generation_confidence: Mapped[Optional[float]] = mapped_column(Float)
    
    # Novelty validation scores
    novelty_score: Mapped[Optional[float]] = mapped_column(Float)  # 1 - max_similarity
    max_similarity: Mapped[Optional[float]] = mapped_column(Float)  # Highest similarity found
    similarity_source: Mapped[Optional[str]] = mapped_column(String(50))  # approved, pending, template, reference
    generation_attempt_count: Mapped[int] = mapped_column(Integer, default=1)
    used_reference_materials: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # Novelty validation metadata (stores detailed similarity breakdown)
    # Format: {"approved_max_sim": 0.3, "pending_max_sim": 0.2, "template_max_sim": 0.4, "reference_max_sim": 0.25}
    novelty_metadata: Mapped[Optional[dict]] = mapped_column(JSON)
    
    # Generation status for internal tracking (not exposed to UI)
    # accepted: passed novelty threshold
    # discarded: failed after max regeneration attempts
    generation_status: Mapped[str] = mapped_column(String(20), default="accepted")
    discard_reason: Mapped[Optional[str]] = mapped_column(Text)
    
    # User interaction
    times_shown: Mapped[int] = mapped_column(Integer, default=0)
    user_rating: Mapped[Optional[int]] = mapped_column(Integer)
    user_difficulty_rating: Mapped[Optional[str]] = mapped_column(String(20))
    user_answer: Mapped[Optional[str]] = mapped_column(Text)
    answer_correctness: Mapped[Optional[bool]] = mapped_column(Boolean)
    
    # Status
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # Version control for regeneration tracking
    replaced_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("questions.id", ondelete="SET NULL"), nullable=True
    )
    replaces_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("questions.id", ondelete="SET NULL"), nullable=True
    )
    version_number: Mapped[int] = mapped_column(Integer, default=1)
    is_latest: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Timestamps
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_shown_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    
    # Metadata
    generation_metadata: Mapped[Optional[dict]] = mapped_column(JSON)
    
    # Relationships
    document = relationship("Document", back_populates="questions")
    subject = relationship("Subject", back_populates="questions")
    topic = relationship("Topic", back_populates="questions")
    
    __table_args__ = (
        CheckConstraint("user_rating BETWEEN 1 AND 5", name="check_user_rating"),
        CheckConstraint("answerability_score BETWEEN 0 AND 1", name="check_answerability"),
        CheckConstraint("specificity_score BETWEEN 0 AND 1", name="check_specificity"),
        CheckConstraint("vetting_status IN ('pending', 'approved', 'rejected')", name="check_vetting_status"),
    )
    
    def __repr__(self) -> str:
        return f"<Question {self.id}>"


class GenerationSession(Base):
    """Generation session model for tracking question generation requests."""
    
    __tablename__ = "generation_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    document_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    subject_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True
    )
    topic_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("topics.id", ondelete="SET NULL"), nullable=True
    )
    
    # Generation method: quick, rubric, chapter, import
    generation_method: Mapped[Optional[str]] = mapped_column(String(20))
    
    # Request parameters
    requested_count: Mapped[int] = mapped_column(Integer, default=0)
    requested_types: Mapped[Optional[List[str]]] = mapped_column(JSON)
    requested_marks: Mapped[Optional[int]] = mapped_column(Integer)
    requested_difficulty: Mapped[Optional[str]] = mapped_column(String(20))
    focus_topics: Mapped[Optional[List[str]]] = mapped_column(JSON)
    
    # Generation tracking
    status: Mapped[str] = mapped_column(String(20), default="in_progress")
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    
    # Results
    questions_generated: Mapped[int] = mapped_column(Integer, default=0)
    questions_failed: Mapped[int] = mapped_column(Integer, default=0)
    questions_duplicate: Mapped[int] = mapped_column(Integer, default=0)
    
    # Performance metrics
    total_duration_seconds: Mapped[Optional[float]] = mapped_column(Float)
    llm_calls: Mapped[Optional[int]] = mapped_column(Integer)
    tokens_used: Mapped[Optional[int]] = mapped_column(Integer)
    
    # Context
    blacklist_size: Mapped[Optional[int]] = mapped_column(Integer)
    chunks_used: Mapped[Optional[int]] = mapped_column(Integer)
    
    # Error handling
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    generation_config: Mapped[Optional[dict]] = mapped_column(JSON)
    
    # Relationships
    user = relationship("User", back_populates="generation_sessions")
    document = relationship("Document", back_populates="generation_sessions")
    
    def __repr__(self) -> str:
        return f"<GenerationSession {self.id}>"
