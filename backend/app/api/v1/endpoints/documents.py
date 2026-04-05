"""
Document management API endpoints.
"""

import os
from typing import Optional, Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query, Form
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.schemas.document import (
    DocumentResponse,
    DocumentListResponse,
    DocumentListItem,
    DocumentUploadResponse,
    PaginationInfo,
)
from app.services.document_service import DocumentService
from app.api.v1.deps import get_current_user, rate_limit
from app.models.user import User


router = APIRouter()


MIME_TYPE_MAPPING = {
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


@router.post("/upload", response_model=DocumentUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    current_user: User = Depends(rate_limit(requests=10, window_seconds=3600)),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a document for processing.
    Supported formats: PDF, DOCX, TXT
    """
    # Validate file extension
    filename = file.filename or "document"
    ext = os.path.splitext(filename)[1].lower()
    
    if ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type. Allowed: {', '.join(settings.ALLOWED_EXTENSIONS)}",
        )
    
    # Read file content
    content = await file.read()
    
    # Validate file size
    if len(content) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size: {settings.MAX_UPLOAD_SIZE_MB}MB",
        )
    
    # Determine mime type
    mime_type = MIME_TYPE_MAPPING.get(ext, "application/octet-stream")
    
    # Upload document
    document_service = DocumentService(db)
    
    try:
        document = await document_service.upload_document(
            user_id=current_user.id,
            filename=filename,
            file_content=content,
            mime_type=mime_type,
        )
        
        return DocumentUploadResponse(
            document_id=document.id,
            filename=document.filename,
            status=document.processing_status,
            message="Document uploaded successfully. Processing started.",
        )
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None, description="Filter by processing status"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List all documents for the current user.
    """
    document_service = DocumentService(db)
    
    documents, pagination = await document_service.get_documents(
        user_id=current_user.id,
        page=page,
        limit=limit,
        status=status,
    )
    
    return DocumentListResponse(
        documents=[
            DocumentListItem(
                id=doc.id,
                filename=doc.filename,
                processing_status=doc.processing_status,
                upload_timestamp=doc.upload_timestamp,
                total_chunks=doc.total_chunks,
                questions_generated=getattr(doc, "questions_generated", 0),
            )
            for doc in documents
        ],
        pagination=pagination,
    )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get document details by ID.
    """
    document_service = DocumentService(db)
    
    document = await document_service.get_document(document_id, current_user.id)
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )
    
    return DocumentResponse.model_validate(document)


@router.delete("/{document_id}")
async def delete_document(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a document and all associated data.
    """
    document_service = DocumentService(db)
    
    success = await document_service.delete_document(document_id, current_user.id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )
    
    return {"message": "Document deleted successfully"}


@router.get("/{document_id}/chunks")
async def get_document_chunks(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get all chunks for a document (for debugging/preview).
    """
    document_service = DocumentService(db)
    
    try:
        chunks = await document_service.get_document_chunks(document_id, current_user.id)
        
        return {
            "document_id": str(document_id),
            "total_chunks": len(chunks),
            "chunks": [
                {
                    "index": chunk.chunk_index,
                    "text": chunk.chunk_text[:500] + "..." if len(chunk.chunk_text) > 500 else chunk.chunk_text,
                    "token_count": chunk.token_count,
                    "page_number": chunk.page_number,
                }
                for chunk in chunks
            ],
        }
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


@router.get("/{document_id}/status")
async def get_document_status(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get document processing status.
    """
    document_service = DocumentService(db)
    
    document = await document_service.get_document(document_id, current_user.id)
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )
    
    return {
        "document_id": str(document.id),
        "filename": document.filename,
        "status": document.processing_status,
        "total_chunks": document.total_chunks,
        "total_tokens": document.total_tokens,
        "processed_at": document.processed_at,
        "processing_step": (document.document_metadata or {}).get("processing_step"),
        "processing_progress": (document.document_metadata or {}).get("processing_progress", 0),
        "processing_detail": (document.document_metadata or {}).get("processing_detail"),
        "total_pages": (document.document_metadata or {}).get("total_pages"),
        "error": (document.document_metadata or {}).get("error"),
    }


# ============== Reference Document Management ==============

@router.post("/reference/upload", response_model=DocumentUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_reference_document(
    file: UploadFile = File(..., description="Reference book PDF, template paper PDF, or reference questions Excel"),
    subject_id: str = Form(..., description="Subject ID to associate the document with"),
    index_type: Literal["reference_book", "template_paper", "reference_questions"] = Form(..., description="Type of reference material"),
    current_user: User = Depends(rate_limit(requests=20, window_seconds=3600)),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a reference document (book, template paper, or reference questions).
    
    - reference_book: PDF used for conceptual inspiration when generating questions
    - template_paper: PDF used for detecting similarity with existing exam questions
    - reference_questions: Excel/CSV of past exam questions used as quality/style templates
    """
    import io
    
    filename = file.filename or "document.pdf"
    ext = os.path.splitext(filename)[1].lower()
    
    # Validate file type based on index_type
    if index_type == "reference_questions":
        if ext not in (".xlsx", ".csv"):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"Reference questions must be .xlsx or .csv files, got: {ext}",
            )
    else:
        if ext not in settings.ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"Unsupported file type. Allowed: {', '.join(settings.ALLOWED_EXTENSIONS)}",
            )
    
    content = await file.read()
    
    if len(content) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size: {settings.MAX_UPLOAD_SIZE_MB}MB",
        )
    
    try:
        parsed_subject_id = uuid.UUID(subject_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid subject_id format",
        )
    
    mime_type = MIME_TYPE_MAPPING.get(ext, "application/octet-stream")
    
    document_service = DocumentService(db)
    
    try:
        document = await document_service.upload_reference_document(
            user_id=current_user.id,
            filename=filename,
            file_content=content,
            mime_type=mime_type,
            subject_id=parsed_subject_id,
            index_type=index_type,
        )
        
        # For reference_questions, parse Excel/CSV and store as structured chunks
        if index_type == "reference_questions":
            parsed_questions = []
            try:
                if ext == ".xlsx":
                    import openpyxl
                    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
                    ws = wb.active
                    
                    row1_values = [str(cell.value).strip().lower() if cell.value else "" for cell in ws[1]]
                    row2_values = [str(cell.value).strip().lower() if cell.value else "" for cell in ws[2]] if ws.max_row >= 2 else []
                    
                    if any("question" in v for v in row2_values):
                        headers = row2_values
                        data_start = 3
                    elif any("question" in v for v in row1_values):
                        headers = row1_values
                        data_start = 2
                    else:
                        headers = row1_values
                        data_start = 2
                    
                    for row in ws.iter_rows(min_row=data_start, values_only=True):
                        if row and any(v is not None for v in row):
                            cells = [str(v).strip() if v is not None else "" for v in row]
                            parsed_questions.append(dict(zip(headers, cells)))
                
                elif ext == ".csv":
                    import csv
                    text = content.decode("utf-8-sig")
                    reader = csv.reader(io.StringIO(text))
                    all_rows = list(reader)
                    if len(all_rows) >= 2:
                        headers = [v.strip().lower() for v in all_rows[0]]
                        for row in all_rows[1:]:
                            if any(v.strip() for v in row):
                                cells = [v.strip() for v in row]
                                parsed_questions.append(dict(zip(headers, cells)))
                
                # Store parsed questions as metadata on the document
                from sqlalchemy import update
                from app.models.document import Document
                
                # Build structured reference question list
                ref_questions = []
                for pq in parsed_questions:
                    q_text = ""
                    for key in pq:
                        if "question" in key and pq[key]:
                            q_text = pq[key]
                            break
                    if not q_text:
                        continue
                    
                    # Extract options
                    options = []
                    for opt_key in ["option_a", "option a", "a", "option_b", "option b", "b", 
                                     "option_c", "option c", "c", "option_d", "option d", "d"]:
                        if opt_key in pq and pq[opt_key]:
                            options.append(pq[opt_key])
                    
                    # Extract correct answer
                    correct = ""
                    for ans_key in ["option_correct", "correct", "answer", "correct_answer", "correct answer"]:
                        if ans_key in pq and pq[ans_key]:
                            correct = pq[ans_key]
                            break
                    
                    # Extract other fields
                    difficulty = ""
                    for d_key in ["difficulty", "difficulty_level"]:
                        if d_key in pq and pq[d_key]:
                            difficulty = pq[d_key]
                            break
                    
                    marks_val = ""
                    for m_key in ["marks", "mark", "points"]:
                        if m_key in pq and pq[m_key]:
                            marks_val = pq[m_key]
                            break
                    
                    co_val = ""
                    for c_key in ["co", "course_outcome", "course outcome"]:
                        if c_key in pq and pq[c_key]:
                            co_val = pq[c_key]
                            break
                    
                    lo_val = ""
                    for l_key in ["lo", "lo mapping", "lo_mapping", "learning_outcome", "learning outcome"]:
                        if l_key in pq and pq[l_key]:
                            lo_val = pq[l_key]
                            break
                    
                    ref_questions.append({
                        "question_text": q_text,
                        "options": options if options else None,
                        "correct_answer": correct or None,
                        "question_type": "mcq" if len(options) >= 3 else "short_answer",
                        "difficulty": difficulty or None,
                        "marks": marks_val or None,
                        "co": co_val or None,
                        "lo": lo_val or None,
                    })
                
                # Update document with parsed data
                await db.execute(
                    update(Document)
                    .where(Document.id == document.id)
                    .values(
                        processing_status="completed",
                        total_chunks=len(ref_questions),
                        document_metadata={
                            "parsed_questions": ref_questions,
                            "total_parsed": len(ref_questions),
                        },
                    )
                )
                await db.commit()
                
                return DocumentUploadResponse(
                    document_id=document.id,
                    filename=document.filename,
                    status="completed",
                    message=f"Reference questions uploaded: {len(ref_questions)} questions parsed from {filename}.",
                )
            except Exception as e:
                import logging
                logging.getLogger(__name__).error(f"Failed to parse reference questions: {e}")
                # Still allow upload even if parsing fails
                await db.execute(
                    update(Document)
                    .where(Document.id == document.id)
                    .values(processing_status="failed")
                )
                await db.commit()
        
        return DocumentUploadResponse(
            document_id=document.id,
            filename=document.filename,
            status=document.processing_status,
            message=f"{index_type.replace('_', ' ').title()} uploaded successfully. Processing started.",
        )
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )


@router.get("/reference/list")
async def list_reference_documents(
    subject_id: Optional[uuid.UUID] = Query(None, description="Filter by subject"),
    index_type: Optional[str] = Query(None, description="Filter by type: reference_book, template_paper, reference_questions"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List reference documents (books, template papers, and reference questions).
    """
    document_service = DocumentService(db)
    
    documents = await document_service.get_reference_documents(
        user_id=current_user.id,
        subject_id=subject_id,
        index_type=index_type,
    )
    
    doc_responses = [
        {
            "id": str(doc.id),
            "filename": doc.filename,
            "file_size_bytes": doc.file_size_bytes,
            "mime_type": doc.mime_type,
            "index_type": doc.index_type,
            "subject_id": str(doc.subject_id) if doc.subject_id else None,
            "processing_status": doc.processing_status,
            "total_chunks": doc.total_chunks,
            "upload_timestamp": doc.upload_timestamp.isoformat() if doc.upload_timestamp else None,
            "processed_at": doc.processed_at.isoformat() if doc.processed_at else None,
            "is_public": doc.is_public,
            "parsed_question_count": (doc.document_metadata or {}).get("total_parsed", 0) if doc.index_type == "reference_questions" else None,
        }
        for doc in documents
    ]
    
    reference_books = [d for d in doc_responses if d["index_type"] == "reference_book"]
    template_papers = [d for d in doc_responses if d["index_type"] == "template_paper"]
    reference_questions = [d for d in doc_responses if d["index_type"] == "reference_questions"]
    
    return {
        "reference_books": reference_books,
        "template_papers": template_papers,
        "reference_questions": reference_questions,
    }


@router.patch("/{document_id}/toggle-visibility")
async def toggle_document_visibility(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Toggle the student visibility (is_public) of a reference document.
    Only the document owner can toggle this.
    """
    from sqlalchemy import update, select
    from app.models.document import Document
    
    # Verify ownership
    result = await db.execute(
        select(Document).where(
            Document.id == document_id,
            Document.user_id == current_user.id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )
    
    new_value = not doc.is_public
    await db.execute(
        update(Document)
        .where(Document.id == document_id)
        .values(is_public=new_value)
    )
    await db.commit()
    
    return {
        "document_id": str(document_id),
        "is_public": new_value,
        "message": f"Document {'shared with students' if new_value else 'hidden from students'}",
    }

