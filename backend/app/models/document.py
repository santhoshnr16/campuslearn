"""
Document and DocumentChunk database models.
"""

from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, BigInteger, DateTime, Text, ForeignKey, func, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from pgvector.sqlalchemy import Vector
import uuid

from app.core.database import Base
from app.core.config import settings


class Document(Base):
    """Document model for uploaded files."""
    
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    subject_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True
    )
    
    # File info
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False)  # SHA-256
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    mime_type: Mapped[Optional[str]] = mapped_column(String(100))
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)
    
    # Document Index Type for novelty system
    # primary: teaching documents (default)
    # reference_book: reference books for inspiration
    # template_paper: template papers/past questions
    index_type: Mapped[str] = mapped_column(String(50), default="primary")  # primary, reference_book, template_paper
    
    # Processing status
    processing_status: Mapped[str] = mapped_column(String(20), default="pending")
    total_chunks: Mapped[Optional[int]] = mapped_column(Integer)
    total_tokens: Mapped[Optional[int]] = mapped_column(Integer)
    
    # Timestamps
    upload_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    
    # Metadata
    document_metadata: Mapped[Optional[dict]] = mapped_column(JSON)
    
    # Sharing (optional feature)
    is_public: Mapped[bool] = mapped_column(default=False)
    share_token: Mapped[Optional[str]] = mapped_column(String(100), unique=True)
    
    # Relationships
    user = relationship("User", back_populates="documents")
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")
    questions = relationship("Question", back_populates="document", cascade="all, delete-orphan")
    generation_sessions = relationship("GenerationSession", back_populates="document", cascade="all, delete-orphan")
    
    def __repr__(self) -> str:
        return f"<Document {self.filename}>"


class DocumentChunk(Base):
    """Document chunk model for RAG retrieval."""
    
    __tablename__ = "document_chunks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    
    # Chunk content
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_embedding = mapped_column(Vector(settings.EMBEDDING_DIMENSION))
    
    # Metadata
    token_count: Mapped[Optional[int]] = mapped_column(Integer)
    page_number: Mapped[Optional[int]] = mapped_column(Integer)
    section_heading: Mapped[Optional[str]] = mapped_column(String(500))
    chunk_metadata: Mapped[Optional[dict]] = mapped_column(JSON)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    
    # Relationships
    document = relationship("Document", back_populates="chunks")
    
    def __repr__(self) -> str:
        return f"<DocumentChunk {self.chunk_index} of {self.document_id}>"
