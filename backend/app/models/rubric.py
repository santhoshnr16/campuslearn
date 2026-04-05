"""
Rubric database model for exam generation.
"""

from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey, func, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import uuid

from app.core.database import Base


class Rubric(Base):
    """Rubric model for exam generation templates."""
    
    __tablename__ = "rubrics"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False
    )
    
    # Rubric info
    name: Mapped[str] = mapped_column(String(255), nullable=False)  # e.g., "CS301 Final Exam 2024"
    exam_type: Mapped[str] = mapped_column(String(50), nullable=False)  # final_exam, mid_term, quiz, assignment
    duration_minutes: Mapped[int] = mapped_column(Integer, default=180)
    
    # Question type distribution (MAP 1)
    # Format: {"mcq": {"count": 20, "marks_each": 2}, "short_notes": {"count": 5, "marks_each": 6}, ...}
    question_type_distribution: Mapped[dict] = mapped_column(JSON, nullable=False)
    
    # Learning Outcomes distribution (MAP 2)
    # Format: {"LO1": 25, "LO2": 25, "LO3": 20, "LO4": 15, "LO5": 15}
    learning_outcomes_distribution: Mapped[dict] = mapped_column(JSON, nullable=False)
    
    # Computed totals
    total_questions: Mapped[int] = mapped_column(Integer, default=0)
    total_marks: Mapped[int] = mapped_column(Integer, default=0)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    
    # Relationships
    user = relationship("User", back_populates="rubrics")
    subject = relationship("Subject", back_populates="rubrics")
    
    def __repr__(self) -> str:
        return f"<Rubric {self.name}>"
