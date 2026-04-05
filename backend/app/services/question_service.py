"""
Question Generation Service - Core RAG Pipeline

This service implements:
1. Retrieval of relevant document chunks using vector similarity
2. Blacklisting of previously generated questions to avoid duplicates
3. LLM-based question generation with structured output
4. Quality validation and deduplication
5. Stateful tracking across sessions
"""

import json
from datetime import datetime, timezone
from typing import Optional, List, AsyncGenerator, Dict, Any, Tuple
import uuid
import asyncio

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.document import Document, DocumentChunk
from app.models.question import Question, GenerationSession
from app.models.subject import Subject
from app.schemas.question import (
    QuestionGenerationRequest,
    QuestionResponse,
    GenerationProgress,
    QuickGenerateProgress,
)
from app.services.embedding_service import EmbeddingService
from app.services.llm_service import LLMService, LLMProvider
from app.services.redis_service import RedisService
from app.services.document_service import DocumentService
from app.services.reranker_service import RerankerService
from app.services.novelty_service import NoveltyService, NoveltyResult
from app.core.config import settings

import logging
logger = logging.getLogger(__name__)


# System prompts for question generation
SYSTEM_PROMPT_MCQ = """You are an expert educator creating CHALLENGING examination questions for university students.

CRITICAL RULES:
1. COGNITIVE DEPTH: Questions should require APPLICATION, ANALYSIS, or EVALUATION - not just recall
2. Create questions that test understanding through:
   - Analyzing relationships between concepts
   - Applying knowledge to solve problems
   - Evaluating scenarios or comparing alternatives
   - Identifying implications or consequences
3. The question MUST be directly answerable from the provided content
4. The correct answer MUST be factually accurate based on the content
5. All 4 options must be plausible and challenging - avoid obviously wrong distractors
6. CHALLENGING PATTERNS:
   - "Which statement BEST explains..."
   - "What would be the MOST LIKELY outcome if..."
   - "Which approach would be MOST effective when..."
   - "What distinguishes X from Y in terms of..."
7. STANDALONE: Write questions as standalone exam questions. NEVER reference "the document", "the content", "the passage", "the text", "according to", or "based on the provided". Questions should read naturally as if from an exam paper.
8. FORBIDDEN: Do NOT start questions with scenario setups like "A clinician", "A patient", "A doctor", "A dentist", "A practitioner", "A student", "A researcher", "An engineer", etc. Start directly with the question using interrogatives (What, Which, How, Why, When, etc.).
9. DEPTH OVER BREADTH: Focus on ONE concept but explore it deeply rather than superficially

Output ONLY valid JSON with this exact format:
{
    "question_text": "Clear, specific question based on the content",
    "options": ["A) First option with actual value", "B) Second option with actual value", "C) Third option with actual value", "D) Fourth option with actual value"],
    "correct_answer": "The letter (A, B, C, or D) of the correct option",
    "explanation": "Why this answer is correct, referencing the source content",
    "topic_tags": ["relevant", "topics"]
}

Example for a math topic:
{
    "question_text": "What is the determinant of matrix A = [[3, 1], [2, 4]]?",
    "options": ["A) 10", "B) 14", "C) 7", "D) 5"],
    "correct_answer": "A",
    "explanation": "The determinant of a 2x2 matrix [[a,b],[c,d]] is ad-bc. So (3*4)-(1*2) = 12-2 = 10",
    "topic_tags": ["matrices", "determinants"]
}"""

SYSTEM_PROMPT_SHORT = """You are an expert educator creating THOUGHT-PROVOKING examination questions for university students.

CRITICAL RULES:
1. COGNITIVE DEPTH: Questions should require EXPLANATION, APPLICATION, or ANALYSIS - not just listing facts
2. Use higher-order question starters:
   - "Explain HOW and WHY..."
   - "Compare and contrast..."
   - "Analyze the relationship between..."
   - "Justify why... would be preferable to..."
   - "Evaluate the effectiveness of..."
3. The question MUST be directly answerable from the provided content
4. Questions should require 3-5 sentence responses demonstrating deep understanding
5. Answers should demonstrate reasoning, not just state facts
6. STANDALONE: Write questions AND answers as standalone exam content. NEVER use phrases like "according to the document", "based on the provided content", "as mentioned in the text", "the passage states", etc. Both questions and answers should read naturally as if from an exam paper, not referencing any source material.
7. FORBIDDEN: Do NOT start questions with scenario setups like "A clinician", "A patient", "A doctor", "A dentist", "A practitioner", "A student", "A researcher", "An engineer", etc. Start directly with action verbs (Explain, Compare, Analyze, Justify, Evaluate, etc.).

Output ONLY valid JSON with this exact format:
{
    "question_text": "Clear question requiring a short written response",
    "expected_answer": "Complete model answer in 2-4 sentences based on the content",
    "key_points": ["key point 1", "key point 2", "key point 3"],
    "topic_tags": ["relevant", "topics"]
}"""

SYSTEM_PROMPT_LONG = """You are an expert educator creating ANALYTICALLY RIGOROUS examination questions for university students.

CRITICAL RULES:
1. HIGHEST COGNITIVE LEVEL: Questions MUST require ANALYSIS, EVALUATION, or SYNTHESIS
2. Create questions that demand:
   - Critical analysis of multiple interconnected concepts
   - Evaluation of approaches with justified reasoning
   - Synthesis of ideas to propose solutions
   - Discussion of implications, limitations, and trade-offs
3. Use analytical question patterns:
   - "Critically analyze..."
   - "Evaluate the advantages and limitations of..."
   - "Discuss how... differs from... in terms of..."
   - "Assess the impact of... on..."
4. The question MUST be directly answerable from the provided content
5. Questions should require comprehensive responses (2-3 paragraphs) with structured argumentation
6. STANDALONE: Write questions AND answers as standalone exam content. NEVER reference "the document", "the content", "according to", "based on the provided", "as stated in", "the text mentions", etc. Both questions and answers should read naturally as professional exam questions and model answers.
7. FORBIDDEN: Do NOT start questions with scenario setups like "A clinician", "A patient", "A doctor", "A dentist", "A practitioner", "A student", "A researcher", "An engineer", etc. Start directly with higher-order verbs (Critically analyze, Evaluate, Discuss, Assess, etc.).

Output ONLY valid JSON with this exact format:
{
    "question_text": "Comprehensive question requiring detailed analysis",
    "expected_answer": "Detailed model answer outline covering main points",
    "key_points": ["main concept 1", "main concept 2", "main concept 3"],
    "rubric": {
        "Understanding": "Demonstrates clear understanding of concepts",
        "Application": "Correctly applies principles",
        "Analysis": "Shows analytical thinking"
    },
    "topic_tags": ["relevant", "topics"]
}"""

BLOOM_TAXONOMY_VERBS = {
    "remember": ["define", "list", "name", "identify", "recall", "state"],
    "understand": ["explain", "describe", "summarize", "interpret", "classify"],
    "apply": ["apply", "demonstrate", "solve", "use", "implement"],
    "analyze": ["analyze", "compare", "contrast", "examine", "differentiate"],
    "evaluate": ["evaluate", "assess", "justify", "critique", "argue"],
    "create": ["create", "design", "develop", "propose", "construct"],
}


class QuestionGenerationService:
    """Service for RAG-based question generation with deduplication and novelty validation."""

    def __init__(
        self,
        db: AsyncSession,
        embedding_service: Optional[EmbeddingService] = None,
        llm_service: Optional[LLMProvider] = None,
        redis_service: Optional[RedisService] = None,
        document_service: Optional[DocumentService] = None,
        reranker_service: Optional[RerankerService] = None,
        novelty_service: Optional[NoveltyService] = None,
    ):
        self.db = db
        self.embedding_service = embedding_service or EmbeddingService()
        self.llm_service = llm_service or LLMService()
        self.redis_service = redis_service or RedisService()
        self.document_service = document_service or DocumentService(db, self.embedding_service)
        self.novelty_service = novelty_service or NoveltyService(db, self.embedding_service)
        # Only initialize reranker if enabled
        if settings.RERANKER_ENABLED:
            self.reranker_service = reranker_service or RerankerService()
        else:
            self.reranker_service = None

    async def generate_questions(
        self,
        user_id: uuid.UUID,
        request: QuestionGenerationRequest,
    ) -> AsyncGenerator[GenerationProgress, None]:
        """
        Generate questions with streaming progress updates.
        Implements the full RAG pipeline with blacklisting.
        """
        document_id = request.document_id

        # 1. Verify document ownership
        document = await self._get_document(document_id, user_id)
        if not document:
            yield GenerationProgress(
                status="error",
                progress=0,
                message="Document not found or access denied",
            )
            return

        if document.processing_status != "completed":
            yield GenerationProgress(
                status="error",
                progress=0,
                message="Document is still processing",
            )
            return

        # 2. Acquire generation lock
        lock_acquired = await self.redis_service.acquire_generation_lock(
            str(user_id), str(document_id)
        )
        if not lock_acquired:
            yield GenerationProgress(
                status="error",
                progress=0,
                message="Another generation is in progress for this document",
            )
            return

        try:
            yield GenerationProgress(
                status="processing",
                progress=5,
                message="Initializing generation session...",
            )

            # 3. Create generation session
            session = await self._create_session(user_id, request)
            
            yield GenerationProgress(
                status="processing",
                progress=10,
                message="Building question blacklist...",
            )

            # 4. Build blacklist from existing questions
            blacklist = await self._build_blacklist(document_id, user_id, request.exclude_question_ids)
            session.blacklist_size = len(blacklist)

            yield GenerationProgress(
                status="processing",
                progress=15,
                message=f"Found {len(blacklist)} existing questions to avoid...",
            )

            # 5. Get document chunks
            chunks = await self._get_chunks(document_id)
            if not chunks:
                yield GenerationProgress(
                    status="error",
                    progress=15,
                    message="No document chunks found",
                )
                return

            session.chunks_used = len(chunks)

            # 5b. Collect reference book document IDs to include in search
            reference_doc_ids: List[uuid.UUID] = []
            if document.subject_id and self.document_service:
                reference_doc_ids = await self.document_service.get_reference_document_ids(
                    user_id=user_id,
                    subject_id=document.subject_id,
                    index_type="reference_book",
                )
                if reference_doc_ids:
                    import logging
                    logging.getLogger(__name__).info(
                        f"generate_questions: Including {len(reference_doc_ids)} reference book(s) in search"
                    )

            # Build list of all document IDs to search across
            all_search_doc_ids = [document_id] + reference_doc_ids

            yield GenerationProgress(
                status="generating",
                progress=20,
                message=f"Generating {request.count} questions from {len(chunks)} chunks...",
                total_questions=request.count,
            )

            # 6. Generate questions
            questions_generated = 0
            questions_failed = 0
            questions_duplicate = 0
            
            # Distribute question types
            type_distribution = self._distribute_types(request.count, request.types)
            
            for q_type, count in type_distribution.items():
                for i in range(count):
                    try:
                        # Select relevant chunks for this question
                        selected_chunks = await self._select_chunks(
                            chunks=chunks,
                            focus_topics=request.focus_topics,
                            blacklist_chunks=blacklist.get("chunks", set()),
                            num_chunks=3,
                            document_id=document_id,
                            document_ids=all_search_doc_ids,
                        )

                        # Generate question
                        question_data = await self._generate_single_question(
                            chunks=selected_chunks,
                            question_type=q_type,
                            difficulty=request.difficulty,
                            marks=request.marks,
                            bloom_levels=request.bloom_levels,
                        )

                        if not question_data:
                            questions_failed += 1
                            continue

                        # Check for duplicates using semantic similarity
                        is_duplicate = await self._check_duplicate(
                            question_text=question_data["question_text"],
                            blacklist_embeddings=blacklist.get("embeddings", []),
                            threshold=0.85,
                        )

                        if is_duplicate:
                            questions_duplicate += 1
                            continue

                        # Save question to database (includes validation)
                        question, question_response = await self._save_question(
                            document_id=document_id,
                            session_id=session.id,
                            question_data=question_data,
                            question_type=q_type,
                            marks=request.marks,
                            difficulty=request.difficulty,
                            chunk_ids=[c.id for c in selected_chunks],
                            chunks=selected_chunks,
                        )
                        
                        questions_generated += 1

                        # Update blacklist with new question
                        blacklist["embeddings"].append(question.question_embedding)

                        # Calculate progress
                        total_attempted = questions_generated + questions_failed + questions_duplicate
                        progress = 20 + int((total_attempted / request.count) * 75)

                        yield GenerationProgress(
                            status="generating",
                            progress=min(progress, 95),
                            current_question=questions_generated,
                            total_questions=request.count,
                            question=question_response,
                            message=f"Generated question {questions_generated}/{request.count}",
                        )

                    except Exception as e:
                        questions_failed += 1
                        # Continue with next question on error

            # 7. Complete session
            session.questions_generated = questions_generated
            session.questions_failed = questions_failed
            session.questions_duplicate = questions_duplicate
            session.status = "completed"
            session.completed_at = datetime.now(timezone.utc)
            session.total_duration_seconds = (
                session.completed_at - session.started_at
            ).total_seconds()
            
            await self.db.commit()

            yield GenerationProgress(
                status="complete",
                progress=100,
                current_question=questions_generated,
                total_questions=request.count,
                message=f"Generated {questions_generated} questions ({questions_duplicate} duplicates avoided)",
            )

        except Exception as e:
            session.status = "failed"
            session.error_message = str(e)
            await self.db.commit()
            
            yield GenerationProgress(
                status="error",
                progress=0,
                message=f"Generation failed: {str(e)}",
            )

        finally:
            # Release lock
            await self.redis_service.release_generation_lock(
                str(user_id), str(document_id)
            )

    async def _get_document(
        self,
        document_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Optional[Document]:
        """Get document with user ownership verification."""
        result = await self.db.execute(
            select(Document).where(
                Document.id == document_id,
                Document.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def _create_session(
        self,
        user_id: uuid.UUID,
        request: QuestionGenerationRequest,
    ) -> GenerationSession:
        """Create a new generation session."""
        session = GenerationSession(
            document_id=request.document_id,
            user_id=user_id,
            requested_count=request.count,
            requested_types=request.types,
            requested_marks=request.marks,
            requested_difficulty=request.difficulty,
            focus_topics=request.focus_topics,
            status="in_progress",
            generation_config={
                "bloom_levels": request.bloom_levels,
                "exclude_ids": [str(id) for id in (request.exclude_question_ids or [])],
            },
        )
        self.db.add(session)
        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def _build_blacklist(
        self,
        document_id: uuid.UUID,
        user_id: uuid.UUID,
        exclude_ids: Optional[List[uuid.UUID]] = None,
    ) -> Dict[str, Any]:
        """
        Build blacklist of existing questions for deduplication.
        Includes questions from all sessions for this document.
        """
        # Get all existing questions for this document
        query = select(Question).where(
            Question.document_id == document_id,
            Question.is_archived == False,
        )
        result = await self.db.execute(query)
        existing_questions = result.scalars().all()

        blacklist = {
            "question_ids": set(),
            "embeddings": [],
            "texts": set(),
            "chunks": set(),
        }

        for q in existing_questions:
            blacklist["question_ids"].add(q.id)
            blacklist["texts"].add(q.question_text.lower().strip())
            
            # Check embedding exists (handle numpy array truth value issue)
            if q.question_embedding is not None and len(q.question_embedding) > 0:
                blacklist["embeddings"].append(q.question_embedding)
            
            if q.source_chunk_ids:
                blacklist["chunks"].update(q.source_chunk_ids)

        # Add manually excluded IDs
        if exclude_ids:
            blacklist["question_ids"].update(exclude_ids)

        return blacklist

    async def _get_chunks(self, document_id: uuid.UUID) -> List[DocumentChunk]:
        """Get all chunks for a document."""
        result = await self.db.execute(
            select(DocumentChunk)
            .options(selectinload(DocumentChunk.document))
            .where(DocumentChunk.document_id == document_id)
            .order_by(DocumentChunk.chunk_index)
        )
        return result.scalars().all()

    async def _select_chunks(
        self,
        chunks: List[DocumentChunk],
        focus_topics: Optional[List[str]],
        blacklist_chunks: set,
        num_chunks: int = 3,
        document_id: Optional[uuid.UUID] = None,
        document_ids: Optional[List[uuid.UUID]] = None,
    ) -> List[DocumentChunk]:
        """
        Select relevant chunks for question generation using hybrid search.
        Prioritizes chunks not heavily used in previous questions.
        
        If document_ids is provided (list of primary + reference doc IDs),
        hybrid search will span all of them. Otherwise falls back to single document_id.
        """
        import random

        # Filter out heavily used chunks
        available_chunks = [c for c in chunks if c.id not in blacklist_chunks]
        
        if not available_chunks:
            # Fall back to all chunks if all are used
            available_chunks = chunks

        if focus_topics:
            # If focus topics provided, use hybrid search
            topic_query = " ".join(focus_topics)
            topic_embedding = await self.embedding_service.get_embedding(topic_query)
            
            # Use multi-document hybrid search if multiple doc IDs available
            if document_ids and self.document_service:
                candidates = await self.document_service.hybrid_search_multi_document(
                    document_ids=document_ids,
                    query=topic_query,
                    query_embedding=topic_embedding,
                    top_k=num_chunks * 3,
                    alpha=0.6,
                )
                # Filter out blacklisted chunks
                candidates = [c for c in candidates if c.id not in blacklist_chunks]
                
                # Rerank using cross-encoder if available
                if self.reranker_service and len(candidates) > num_chunks:
                    selected = self.reranker_service.rerank(
                        query=topic_query,
                        chunks=candidates,
                        top_k=num_chunks,
                    )
                else:
                    selected = candidates[:num_chunks]
                
                return selected
            elif document_id and self.document_service:
                # Fallback: single document hybrid search
                candidates = await self.document_service.hybrid_search(
                    document_id=document_id,
                    query=topic_query,
                    query_embedding=topic_embedding,
                    top_k=num_chunks * 3,  # Get more for filtering and reranking
                    alpha=0.6,  # Slightly favor semantic search
                )
                # Filter out blacklisted chunks
                candidates = [c for c in candidates if c.id not in blacklist_chunks]
                
                # Rerank using cross-encoder if available
                if self.reranker_service and len(candidates) > num_chunks:
                    selected = self.reranker_service.rerank(
                        query=topic_query,
                        chunks=candidates,
                        top_k=num_chunks,
                    )
                else:
                    selected = candidates[:num_chunks]
                
                return selected
            
            # Fallback: Score chunks by relevance using only vector similarity
            scored_chunks = []
            for chunk in available_chunks:
                if chunk.chunk_embedding is not None and len(chunk.chunk_embedding) > 0:
                    similarity = self.embedding_service.compute_similarity(
                        topic_embedding, chunk.chunk_embedding
                    )
                    scored_chunks.append((chunk, similarity))
            
            # Sort by similarity and take top chunks
            scored_chunks.sort(key=lambda x: x[1], reverse=True)
            candidates = [c for c, _ in scored_chunks[:num_chunks * 2]]
            
            # Rerank using cross-encoder if available
            if self.reranker_service and len(candidates) > num_chunks:
                selected = self.reranker_service.rerank(
                    query=topic_query,
                    chunks=candidates,
                    top_k=num_chunks,
                )
            else:
                selected = candidates[:num_chunks]
        else:
            # Random selection with some diversity
            selected = random.sample(
                available_chunks,
                min(num_chunks, len(available_chunks))
            )

        return selected

    async def _expand_query(
        self,
        context: str,
        num_variations: int = 3,
    ) -> List[str]:
        """
        Generate query variations using LLM for better retrieval coverage.
        
        This helps find relevant chunks that might use different terminology
        or phrasing than the original query.
        """
        prompt = f"""Given this topic/context: "{context}"

Generate {num_variations} alternative search queries that would help find relevant educational content about this topic.
Each query should use different terminology or focus on different aspects of the topic.

Output as a JSON array of strings: ["query1", "query2", "query3"]

Output JSON only, no explanation."""

        try:
            response = await self.llm_service.generate_json(
                prompt=prompt,
                temperature=0.7,
            )
            
            if isinstance(response, list):
                # Ensure all items are strings
                queries = [str(q) for q in response if q][:num_variations]
            else:
                queries = []
            
            # Always include the original context as the first query
            return [context] + queries
            
        except Exception:
            # On any error, just return the original context
            return [context]

    async def _select_chunks_with_expansion(
        self,
        chunks: List[DocumentChunk],
        context: str,
        blacklist_chunks: set,
        num_chunks: int = 3,
        document_id: Optional[uuid.UUID] = None,
        document_ids: Optional[List[uuid.UUID]] = None,
        expand_queries: bool = True,
    ) -> List[DocumentChunk]:
        """
        Select chunks using query expansion for better coverage.
        
        This generates multiple query variations and combines results
        for more comprehensive chunk selection.
        
        If document_ids is provided (list of primary + reference doc IDs),
        hybrid search will span all of them. Otherwise falls back to single document_id.
        """
        from collections import defaultdict
        
        # Filter out heavily used chunks
        available_chunks = [c for c in chunks if c.id not in blacklist_chunks]
        
        if not available_chunks:
            available_chunks = chunks
        
        # Get query variations
        if expand_queries:
            queries = await self._expand_query(context, num_variations=2)
        else:
            queries = [context]
        
        # Score each chunk across all queries (take max score for each chunk)
        chunk_scores = defaultdict(float)
        all_seen_chunks: Dict[uuid.UUID, DocumentChunk] = {}  # Track all chunk objects seen
        
        for query in queries:
            query_embedding = await self.embedding_service.get_embedding(query)
            
            # Use multi-document hybrid search if multiple doc IDs available
            if document_ids and self.document_service:
                candidates = await self.document_service.hybrid_search_multi_document(
                    document_ids=document_ids,
                    query=query,
                    query_embedding=query_embedding,
                    top_k=num_chunks * 2,
                    alpha=0.6,
                )
                # Filter and score by rank
                for rank, chunk in enumerate(candidates):
                    all_seen_chunks[chunk.id] = chunk
                    if chunk.id not in blacklist_chunks:
                        score = 1.0 / (rank + 1)
                        chunk_scores[chunk.id] = max(chunk_scores[chunk.id], score)
            elif document_id and self.document_service:
                candidates = await self.document_service.hybrid_search(
                    document_id=document_id,
                    query=query,
                    query_embedding=query_embedding,
                    top_k=num_chunks * 2,
                    alpha=0.6,
                )
                # Filter and score by rank
                for rank, chunk in enumerate(candidates):
                    all_seen_chunks[chunk.id] = chunk
                    if chunk.id not in blacklist_chunks:
                        # Higher rank = lower score index, invert for max
                        score = 1.0 / (rank + 1)
                        chunk_scores[chunk.id] = max(chunk_scores[chunk.id], score)
            else:
                # Fallback to embedding similarity
                for chunk in available_chunks:
                    all_seen_chunks[chunk.id] = chunk
                    # Check embedding exists (handle numpy array truth value issue)
                    if chunk.chunk_embedding is not None and len(chunk.chunk_embedding) > 0:
                        sim = self.embedding_service.compute_similarity(
                            query_embedding, chunk.chunk_embedding
                        )
                        chunk_scores[chunk.id] = max(chunk_scores[chunk.id], sim)
        
        # Sort chunks by combined score
        # Build chunk_map from available_chunks plus any chunks from hybrid search (incl. reference books)
        chunk_map = {c.id: c for c in available_chunks}
        chunk_map.update(all_seen_chunks)
        sorted_ids = sorted(chunk_scores.keys(), key=lambda x: chunk_scores[x], reverse=True)
        candidates = [chunk_map[cid] for cid in sorted_ids if cid in chunk_map]
        
        # Rerank if available
        if self.reranker_service and len(candidates) > num_chunks:
            return self.reranker_service.rerank(
                query=context,  # Use original context for reranking
                chunks=candidates,
                top_k=num_chunks,
            )
        
        return candidates[:num_chunks]

    async def _generate_single_question(
        self,
        chunks: List[DocumentChunk],
        question_type: str,
        difficulty: str,
        marks: Optional[int],
        bloom_levels: Optional[List[str]],
    ) -> Optional[Dict[str, Any]]:
        """Generate a single question using LLM."""
        # Build context from chunks
        context = "\n\n---\n\n".join([c.chunk_text for c in chunks])
        
        # Select system prompt based on type
        if question_type == "mcq":
            system_prompt = SYSTEM_PROMPT_MCQ
        elif question_type == "short_answer":
            system_prompt = SYSTEM_PROMPT_SHORT
        else:
            system_prompt = SYSTEM_PROMPT_LONG

        # Select Bloom's level
        bloom_level = None
        if bloom_levels:
            import random
            bloom_level = random.choice(bloom_levels)
        else:
            # Elevated defaults for more challenging questions
            bloom_defaults = {
                "mcq": "apply",  # Changed from "understand" to "apply"
                "short_answer": "analyze",  # Changed from "apply" to "analyze"
                "long_answer": "evaluate",  # Changed from "analyze" to "evaluate"
            }
            bloom_level = bloom_defaults.get(question_type, "apply")

        # Build prompt
        prompt = f"""Context from the document:
{context}

Generate a {question_type.replace('_', ' ')} question with the following requirements:
- Difficulty: {difficulty}
- Bloom's Taxonomy Level: {bloom_level}
- Marks: {marks or 'appropriate for the question type'}

The question should be based directly on the provided context.
Ensure the question is clear, specific, and examines understanding of the material.

Output valid JSON only."""

        try:
            response = await self.llm_service.generate_json(
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=0.7,
            )
            
            response["bloom_taxonomy_level"] = bloom_level
            return response
            
        except Exception as e:
            return None

    async def _check_duplicate(
        self,
        question_text: str,
        blacklist_embeddings: List[List[float]],
        threshold: float = 0.85,
    ) -> bool:
        """Check if question is semantically similar to existing questions."""
        if not blacklist_embeddings:
            return False

        # Get embedding for new question
        new_embedding = await self.embedding_service.get_embedding(question_text)
        
        # Check similarity against all blacklisted embeddings
        similarities = self.embedding_service.compute_similarity_batch(
            new_embedding, blacklist_embeddings
        )
        
        # If any similarity is above threshold, it's a duplicate
        return any(s > threshold for s in similarities)

    async def _validate_question_quality(
        self,
        question_data: Dict[str, Any],
        question_type: str,
        chunks: List[DocumentChunk],
    ) -> tuple[bool, str, float]:
        """
        Validate the quality of a generated question.
        
        Returns:
            Tuple of (is_valid, reason, confidence_score)
        """
        import re
        
        q_text = question_data.get("question_text", "").strip()
        
        # Basic length checks
        if len(q_text) < 15:
            return False, "Question too short", 0.0
        if len(q_text) > 1000:
            return False, "Question too long", 0.0
        
        # Check question has interrogative structure
        question_patterns = [
            r'\?\s*$',  # Ends with question mark (allowing trailing spaces)
            r'^(?:.*?[,:]\s*)?(what|which|who|whom|whose|when|where|why|how|is|are|was|were|do|does|did|can|could|will|would|should|shall)\b',
            r'^(?:.*?[,:]\s*)?(explain|describe|define|compare|contrast|analyze|evaluate|discuss|identify|list|name|state|select|choose|classify)\b',
            # Math/engineering imperative patterns (common in exam questions)
            r'^(?:.*?[,:]\s*)?(find|calculate|determine|solve|compute|derive|prove|show|simplify|verify|express|convert|obtain)\b',
            r'^(given|consider|let|suppose|assume|if|according|in the context|from the|among the|a student|a system|an engineer)\b',  # Conditional/setup patterns
            r'(find|calculate|determine|solve|compute|identify|select|choose)\s+(the|a|an)\b',  # Mid-sentence imperatives
        ]
        has_question_structure = any(
            re.search(pattern, q_text, re.IGNORECASE) for pattern in question_patterns
        )
        if not has_question_structure:
            return False, "Question lacks proper interrogative structure", 0.3
        
        # NOTE: Grounding overlap check removed — it was unreliable (punctuation, stemming,
        # and LLM rephrasing all caused false rejections on perfectly valid questions).
        # The LLM generates questions from provided chunks, so grounding is inherent.
        
        
        # MCQ-specific validation
        if question_type == "mcq":
            options = question_data.get("options", [])
            correct_answer = question_data.get("correct_answer", "")
            
            if not options:
                return False, "MCQ missing options", 0.0
            if len(options) < 3:
                return False, f"MCQ has only {len(options)} options, needs at least 3", 0.3
            if len(options) > 6:
                return False, "MCQ has too many options", 0.5
            
            # Check for unique options
            option_texts = [self._extract_option_text(opt) for opt in options]
            if len(set(option_texts)) != len(option_texts):
                return False, "MCQ options are not unique", 0.3
            
            # Check correct answer is provided
            if not correct_answer:
                return False, "MCQ missing correct answer", 0.0
            
            # Check options are not too similar
            if await self._check_options_too_similar(options):
                return False, "MCQ options are too similar to each other", 0.4
        
        # Short answer validation
        elif question_type == "short_answer":
            expected_answer = question_data.get("expected_answer") or question_data.get("correct_answer")
            if not expected_answer:
                return False, "Short answer missing expected answer", 0.0
            if len(str(expected_answer)) < 10:
                return False, "Expected answer too brief", 0.5
        
        # Long answer validation
        elif question_type == "long_answer":
            key_points = question_data.get("key_points", [])
            if not key_points or len(key_points) < 2:
                return False, "Long answer should have at least 2 key points", 0.5
        
        # Calculate confidence score based on available factors
        confidence = 0.75  # Base confidence
        
        # Boost for having proper structure
        if has_question_structure:
            confidence += 0.1
        
        # Cap at 0.95
        confidence = min(confidence, 0.95)
        
        return True, "Valid", confidence

    def _extract_option_text(self, option: str) -> str:
        """Extract the text portion of an option, removing the label."""
        import re
        # Remove labels like "A)", "1.", "a." etc.
        cleaned = re.sub(r'^[A-Za-z0-9][).:\s]+', '', str(option).strip())
        return cleaned.lower().strip()

    async def _check_options_too_similar(
        self,
        options: List[str],
        similarity_threshold: float = 0.96,
    ) -> bool:
        """Check if any options are too similar to each other."""
        if len(options) < 2:
            return False
        
        option_texts = [self._extract_option_text(opt) for opt in options]
        embeddings = await self.embedding_service.get_embeddings(option_texts)
        
        # Check pairwise similarities
        for i in range(len(embeddings)):
            for j in range(i + 1, len(embeddings)):
                similarity = self.embedding_service.compute_similarity(
                    embeddings[i], embeddings[j]
                )
                if similarity > similarity_threshold:
                    return True
        
        return False

    async def _save_question(
        self,
        document_id: uuid.UUID,
        session_id: uuid.UUID,
        question_data: Dict[str, Any],
        question_type: str,
        marks: Optional[int],
        difficulty: str,
        chunk_ids: List[uuid.UUID],
        chunks: Optional[List[DocumentChunk]] = None,
        subject_id: Optional[uuid.UUID] = None,
        topic_id: Optional[uuid.UUID] = None,
    ) -> tuple[Question, QuestionResponse]:
        """
        Save generated question to database after validation.
        
        Returns both the ORM object (for embedding access) and the 
        QuestionResponse (for SSE serialization without lazy loading issues).
        """

        
        # Validate question quality if chunks provided
        confidence_score = 0.8  # Default confidence
        if chunks:
            is_valid, reason, confidence_score = await self._validate_question_quality(
                question_data, question_type, chunks
            )
            if not is_valid:
                logger.warning(f"Question validation failed: {reason}")
                raise ValueError(f"Question validation failed: {reason}")
        
        # Generate embedding for the question
        question_embedding = await self.embedding_service.get_embedding(
            question_data["question_text"]
        )
        
        # Normalize options - LLM may return different formats
        raw_options = question_data.get("options")
        normalized_options = None
        if raw_options:
            normalized_options = self._normalize_options(raw_options)
        
        # Normalize correct answer
        correct_answer = question_data.get("correct_answer") or question_data.get("expected_answer") or question_data.get("answer")
        if isinstance(correct_answer, dict):
            correct_answer = correct_answer.get("option") or correct_answer.get("value") or str(correct_answer)

        # Build source information from chunks
        source_info = self._build_source_info(chunks, question_data)
        logger.info(f"Built source info with {len(source_info.get('sources', []))} sources for question")

        question = Question(
            document_id=document_id,
            session_id=session_id,
            subject_id=subject_id,
            topic_id=topic_id,
            question_text=question_data["question_text"],
            question_embedding=question_embedding,
            question_type=question_type,
            marks=marks,
            difficulty_level=(difficulty or "medium")[:20],
            bloom_taxonomy_level=(question_data.get("bloom_taxonomy_level") or "understand")[:30],
            correct_answer=str(correct_answer) if correct_answer else None,
            options=normalized_options,
            topic_tags=question_data.get("topic_tags"),
            source_chunk_ids=chunk_ids,
            generation_confidence=confidence_score,  # Calculated from validation
            generation_metadata={
                "raw_response": question_data,
                "source_info": source_info,
            },
        )
        
        self.db.add(question)
        await self.db.commit()
        await self.db.refresh(question)
        
        # Import source info schema
        from app.schemas.question import QuestionSourceInfo, SourceReference
        
        # Build source_info for response
        source_info_response = None
        if source_info and source_info.get("sources"):
            source_info_response = QuestionSourceInfo(
                sources=[SourceReference(**s) for s in source_info.get("sources", [])],
                generation_reasoning=source_info.get("generation_reasoning"),
                content_coverage=source_info.get("content_coverage"),
            )
        
        # Convert to QuestionResponse immediately while in async context
        # This avoids SQLAlchemy lazy-loading issues when serializing later
        question_response = QuestionResponse(
            id=question.id,
            document_id=question.document_id,
            subject_id=question.subject_id,
            topic_id=question.topic_id,
            session_id=question.session_id,
            question_text=question.question_text,
            question_type=question.question_type,
            marks=question.marks,
            difficulty_level=question.difficulty_level,
            bloom_taxonomy_level=question.bloom_taxonomy_level,
            options=question.options,
            correct_answer=question.correct_answer,
            topic_tags=question.topic_tags,
            source_chunk_ids=question.source_chunk_ids,
            source_info=source_info_response,
            course_outcome_mapping=question.course_outcome_mapping,
            learning_outcome_id=question.learning_outcome_id,
            vetting_status=question.vetting_status,
            vetted_at=question.vetted_at,
            vetting_notes=question.vetting_notes,
            answerability_score=question.answerability_score,
            specificity_score=question.specificity_score,
            generation_confidence=question.generation_confidence,
            generated_at=question.generated_at,
            times_shown=question.times_shown,
            user_rating=question.user_rating,
            is_archived=question.is_archived,
        )
        
        return question, question_response
    
    def _build_source_info(
        self,
        chunks: Optional[List[DocumentChunk]],
        question_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Build source information from chunks for question attribution.
        
        Returns a dict containing:
        - sources: List of source references with page/position info
        - generation_reasoning: Why this question was generated
        - content_coverage: What aspects are covered
        """
        if not chunks:
            return {"sources": [], "generation_reasoning": None, "content_coverage": None}
        
        sources = []
        for chunk in chunks:
            # Extract source info from chunk metadata
            chunk_meta = chunk.chunk_metadata or {}
            source_info = chunk_meta.get("source_info", {})
            
            # Get document name - try multiple sources
            document_name = source_info.get("document_name")
            if not document_name and hasattr(chunk, 'document') and chunk.document:
                document_name = chunk.document.filename
            if not document_name:
                document_name = "Unknown Document"
            
            # Store full content snippet (frontend will handle truncation and expansion)
            content_snippet = chunk.chunk_text
            
            source = {
                "document_name": document_name,
                "page_number": chunk.page_number or source_info.get("page_number"),
                "page_range": source_info.get("page_range"),
                "position_in_page": source_info.get("position_in_page"),
                "position_percentage": source_info.get("position_percentage"),
                "section_heading": chunk.section_heading,
                "content_snippet": content_snippet,
                "relevance_reason": self._generate_relevance_reason(chunk, question_data),
            }
            logger.debug(f"Source built: doc={document_name}, page={source['page_number']}, pos={source['position_in_page']}")
            sources.append(source)
        
        # Generate overall reasoning
        generation_reasoning = self._generate_question_reasoning(chunks, question_data)
        
        # Determine content coverage
        content_coverage = self._determine_content_coverage(chunks, question_data)
        
        return {
            "sources": sources,
            "generation_reasoning": generation_reasoning,
            "content_coverage": content_coverage,
        }
    
    def _generate_relevance_reason(
        self,
        chunk: DocumentChunk,
        question_data: Dict[str, Any],
    ) -> str:
        """Generate a brief explanation of why this chunk was relevant to the question."""
        question_text = question_data.get("question_text", "")
        topic_tags = question_data.get("topic_tags", [])
        
        # Simple heuristic-based reasoning
        reasons = []
        
        # Check if section heading matches question topic
        if chunk.section_heading:
            reasons.append(f"Contains section on '{chunk.section_heading}'")
        
        # Check for topic tag matches
        chunk_text_lower = chunk.chunk_text.lower()
        for tag in topic_tags:
            if tag.lower() in chunk_text_lower:
                reasons.append(f"Covers topic: {tag}")
                break
        
        # Check metadata for content type
        chunk_meta = chunk.chunk_metadata or {}
        if chunk_meta.get("has_definition"):
            reasons.append("Contains key definitions")
        if chunk_meta.get("has_math"):
            reasons.append("Contains mathematical content")
        if chunk_meta.get("has_code"):
            reasons.append("Contains code examples")
        
        if not reasons:
            reasons.append("High semantic similarity to question topic")
        
        return "; ".join(reasons[:2])  # Limit to 2 reasons
    
    def _generate_question_reasoning(
        self,
        chunks: List[DocumentChunk],
        question_data: Dict[str, Any],
    ) -> str:
        """Generate an explanation of why this question was created from the sources."""
        question_type = question_data.get("question_type", "question")
        topic_tags = question_data.get("topic_tags", [])
        bloom_level = question_data.get("bloom_taxonomy_level", "understand")
        
        # Build reasoning based on question characteristics
        if topic_tags:
            topic_str = ", ".join(topic_tags[:3])
            return f"Generated to assess {bloom_level}-level understanding of {topic_str} based on content from {len(chunks)} source section(s)."
        else:
            return f"Generated to test {bloom_level}-level comprehension of key concepts from the source material."
    
    def _determine_content_coverage(
        self,
        chunks: List[DocumentChunk],
        question_data: Dict[str, Any],
    ) -> str:
        """Determine what aspects of the content the question covers."""
        aspects = []
        
        for chunk in chunks:
            meta = chunk.chunk_metadata or {}
            if meta.get("has_definition"):
                aspects.append("definitions")
            if meta.get("has_math"):
                aspects.append("mathematical concepts")
            if meta.get("has_code"):
                aspects.append("code/programming")
            if meta.get("has_list"):
                aspects.append("key points/lists")
        
        # Deduplicate
        unique_aspects = list(dict.fromkeys(aspects))
        
        if unique_aspects:
            return f"Covers: {', '.join(unique_aspects[:4])}"
        else:
            return "Covers core concepts from the source text"
    
    def _normalize_options(self, options: List[Any]) -> List[str]:
        """Normalize options to list of strings in format 'A) text'."""
        if not options:
            return []
        
        normalized = []
        labels = ['A', 'B', 'C', 'D', 'E', 'F']
        
        for i, opt in enumerate(options):
            label = labels[i] if i < len(labels) else str(i + 1)
            
            if isinstance(opt, str):
                # Already a string - check if it has a label prefix
                if opt.strip() and opt[0].isalpha() and len(opt) > 1 and opt[1] in ').:':
                    normalized.append(opt)
                else:
                    normalized.append(f"{label}) {opt}")
            elif isinstance(opt, dict):
                # Handle dict format: {"option": "value", "description": "text"}
                text = opt.get("description") or opt.get("text") or opt.get("option") or opt.get("value") or str(opt)
                option_val = opt.get("option") or opt.get("value")
                if option_val and text != option_val:
                    normalized.append(f"{label}) {option_val} - {text}")
                else:
                    normalized.append(f"{label}) {text}")
            else:
                normalized.append(f"{label}) {str(opt)}")
        
        return normalized

    async def _generate_with_novelty_validation(
        self,
        user_id: uuid.UUID,
        document_id: uuid.UUID,
        chunks: List[DocumentChunk],
        question_type: str,
        difficulty: str,
        marks: Optional[int],
        bloom_levels: Optional[List[str]],
        context: str,
        session_id: uuid.UUID,
        subject_id: Optional[uuid.UUID] = None,
        topic_id: Optional[uuid.UUID] = None,
        generated_embeddings: Optional[List[List[float]]] = None,
        document_ids: Optional[List[uuid.UUID]] = None,
    ) -> Tuple[Optional[Question], Optional[QuestionResponse], List[float]]:
        """
        Generate a question with novelty validation and intelligent regeneration.
        
        Returns:
            Tuple of (Question ORM object, QuestionResponse, question embedding)
            Returns (None, None, []) if generation fails after all attempts.
        """
        import logging
        logger = logging.getLogger(__name__)
        
        generated_embeddings = generated_embeddings or []
        
        # Get user's novelty settings
        novelty_settings = await self.novelty_service.get_user_novelty_settings(user_id)
        novelty_threshold = novelty_settings["novelty_threshold"]
        max_attempts = novelty_settings["max_regeneration_attempts"]
        
        used_chunk_ids: List[uuid.UUID] = []
        used_reference = False
        current_chunks = chunks
        
        for attempt in range(1, max_attempts + 1):
            logger.info(f"Generation attempt {attempt}/{max_attempts} for {question_type}")
            
            # Determine if we should use reference materials
            use_reference = await self.novelty_service.should_use_reference(attempt, max_attempts)
            
            # Build diversity instructions for regeneration attempts
            diversity_instructions = ""
            if attempt > 1:
                diversity_instructions = self._build_diversity_prompt(attempt, use_reference)
            
            # Generate question
            question_data = await self._generate_single_question_with_diversity(
                chunks=current_chunks,
                question_type=question_type,
                difficulty=difficulty,
                marks=marks,
                bloom_levels=bloom_levels,
                context=context,
                diversity_instructions=diversity_instructions,
                use_reference=use_reference,
                user_id=user_id,
                subject_id=subject_id,
            )
            
            if not question_data:
                logger.warning(f"Attempt {attempt}: Question generation returned None")
                continue
            
            # Check for within-session duplicates first (fast check)
            question_text = question_data.get("question_text", "")
            if not question_text or len(question_text) < 15:
                continue
            
            question_embedding = await self.embedding_service.get_embedding(question_text)
            
            if generated_embeddings:
                similarities = self.embedding_service.compute_similarity_batch(
                    question_embedding, generated_embeddings
                )
                if any(s > 0.85 for s in similarities):
                    logger.info(f"Attempt {attempt}: Within-session duplicate detected")
                    continue
            
            # Compute novelty score against all sources
            novelty_result = await self.novelty_service.compute_novelty(
                question_text=question_text,
                question_embedding=question_embedding,
                user_id=user_id,
                subject_id=subject_id,
            )
            
            logger.info(
                f"Attempt {attempt}: Novelty score = {novelty_result.novelty_score:.2f}, "
                f"threshold = {novelty_threshold}, source = {novelty_result.similarity_source}"
            )
            
            # Check if novelty threshold is met
            if novelty_result.novelty_score >= novelty_threshold:
                # Save the question with novelty metadata
                try:
                    question, question_response = await self._save_question_with_novelty(
                        document_id=document_id,
                        session_id=session_id,
                        question_data=question_data,
                        question_type=question_type,
                        marks=marks,
                        difficulty=difficulty,
                        chunk_ids=[c.id for c in current_chunks],
                        chunks=current_chunks,
                        subject_id=subject_id,
                        topic_id=topic_id,
                        novelty_result=novelty_result,
                        attempt_count=attempt,
                        used_reference=used_reference or use_reference,
                    )
                    
                    logger.info(f"Question accepted with novelty score {novelty_result.novelty_score:.2f}")
                    return question, question_response, question_embedding
                    
                except Exception as e:
                    logger.error(f"Failed to save question: {e}")
                    await self.db.rollback()
                    continue
            
            # Novelty threshold not met - prepare for regeneration
            logger.info(f"Attempt {attempt}: Novelty threshold not met, preparing for regeneration")
            
            # Track used chunks to avoid reusing them
            used_chunk_ids.extend([c.id for c in current_chunks])
            
            # Get alternative chunks for next attempt
            if use_reference and subject_id:
                used_reference = True
                
                if document_ids and self.document_service:
                    # Use hybrid search across all documents (primary + reference books)
                    alternative_chunks = await self.document_service.hybrid_search_multi_document(
                        document_ids=document_ids,
                        query=question_text,
                        query_embedding=question_embedding,
                        top_k=4,
                        alpha=0.6,
                    )
                    # Filter out previously used chunks
                    current_chunks = [c for c in alternative_chunks if c.id not in set(used_chunk_ids)]
                    if not current_chunks:
                        current_chunks = alternative_chunks[:3]
                else:
                    # Fallback: vector-only reference chunks + primary alternatives
                    reference_chunks = await self.document_service.get_reference_chunks(
                        user_id=user_id,
                        subject_id=subject_id,
                        query_embedding=question_embedding,
                        top_k=2,
                    )
                    
                    # Combine primary and reference chunks
                    primary_alternatives = await self.document_service.get_primary_chunks_excluding_used(
                        document_id=document_id,
                        used_chunk_ids=used_chunk_ids,
                        query_embedding=question_embedding,
                        top_k=2,
                    )
                    
                    current_chunks = primary_alternatives + reference_chunks
            else:
                # Get alternative primary chunks
                current_chunks = await self.document_service.get_primary_chunks_excluding_used(
                    document_id=document_id,
                    used_chunk_ids=used_chunk_ids,
                    query_embedding=question_embedding,
                    top_k=3,
                )
            
            # If no more chunks available, fall back to original
            if not current_chunks:
                current_chunks = chunks
        
        # All attempts exhausted - log discarded question
        logger.warning(f"Question discarded after {max_attempts} attempts - novelty threshold not met")
        
        return None, None, []

    def _build_diversity_prompt(self, attempt: int, use_reference: bool) -> str:
        """Build diversity instructions for regeneration attempts."""
        instructions = [
            "\n\nDIVERSITY REQUIREMENTS (this is a regeneration attempt):",
            "- Generate a SEMANTICALLY DIFFERENT question from previous attempts",
        ]
        
        if attempt == 2:
            instructions.extend([
                "- Use different phrasing and sentence structure",
                "- Focus on a different aspect of the same concept",
            ])
        elif attempt >= 3:
            instructions.extend([
                "- Approach the topic from a completely different angle",
                "- Use a different context or scenario",
                "- Consider alternative applications or examples",
            ])
        
        if use_reference:
            instructions.extend([
                "\nREFERENCE MATERIAL USAGE:",
                "- Use reference content ONLY for conceptual inspiration",
                "- Do NOT copy or closely paraphrase reference questions",
                "- Create an ORIGINAL question that tests similar concepts differently",
            ])
        
        return "\n".join(instructions)

    async def _generate_single_question_with_diversity(
        self,
        chunks: List[DocumentChunk],
        question_type: str,
        difficulty: str,
        marks: Optional[int],
        bloom_levels: Optional[List[str]],
        context: str = "",
        diversity_instructions: str = "",
        use_reference: bool = False,
        user_id: Optional[uuid.UUID] = None,
        subject_id: Optional[uuid.UUID] = None,
    ) -> Optional[Dict[str, Any]]:
        """Generate a single question with optional diversity instructions."""
        import logging
        logger = logging.getLogger(__name__)
        
        # Build context from chunks
        doc_content = "\n\n---\n\n".join([c.chunk_text for c in chunks])
        
        # Select system prompt based on type
        if question_type == "mcq":
            system_prompt = SYSTEM_PROMPT_MCQ
        elif question_type == "short_answer":
            system_prompt = SYSTEM_PROMPT_SHORT
        else:
            system_prompt = SYSTEM_PROMPT_LONG
        
        # Select Bloom's level
        bloom_level = None
        if bloom_levels:
            import random
            bloom_level = random.choice(bloom_levels)
        else:
            # Elevated defaults for more challenging questions
            bloom_defaults = {
                "mcq": "apply",  # Changed from "understand" to "apply"
                "short_answer": "analyze",  # Changed from "apply" to "analyze"
                "long_answer": "evaluate",  # Changed from "analyze" to "evaluate"
            }
            bloom_level = bloom_defaults.get(question_type, "apply")
        
        # Build enhanced prompt
        prompt = f"""Topic/Context: {context}

Content from the document:
{doc_content}

Generate a {question_type.replace('_', ' ')} question with the following requirements:
- The question should be relevant to the topic: "{context}"
- Difficulty: {difficulty}
- Bloom's Taxonomy Level: {bloom_level}
- Marks: {marks or 'appropriate for the question type'}
- The question must be directly answerable from the provided content
- Ensure the question is clear, specific, and tests understanding of the material
{diversity_instructions}

Output valid JSON only."""

        try:
            response = await self._generate_with_retry(
                prompt=prompt,
                system_prompt=system_prompt,
                question_type=question_type,
            )
            
            if not response:
                return None
            
            # Normalize response keys
            if "question" in response and "question_text" not in response:
                response["question_text"] = response.pop("question")
            if "text" in response and "question_text" not in response:
                response["question_text"] = response.pop("text")
            
            if "question_text" not in response:
                return None
            
            response["bloom_taxonomy_level"] = bloom_level
            return response
            
        except Exception as e:
            logger.exception(f"Failed to generate question: {e}")
            return None

    async def _save_question_with_novelty(
        self,
        document_id: uuid.UUID,
        session_id: uuid.UUID,
        question_data: Dict[str, Any],
        question_type: str,
        marks: Optional[int],
        difficulty: str,
        chunk_ids: List[uuid.UUID],
        chunks: List[DocumentChunk],
        novelty_result: NoveltyResult,
        attempt_count: int,
        used_reference: bool,
        subject_id: Optional[uuid.UUID] = None,
        topic_id: Optional[uuid.UUID] = None,
    ) -> tuple[Question, QuestionResponse]:
        """Save a question with novelty metadata."""
        import logging
        logger = logging.getLogger(__name__)
        
        # Validate question quality if chunks provided
        confidence_score = 0.8
        if chunks:
            is_valid, reason, confidence_score = await self._validate_question_quality(
                question_data, question_type, chunks
            )
            if not is_valid:
                logger.warning(f"Question validation failed: {reason}")
                raise ValueError(f"Question validation failed: {reason}")
        
        # Generate embedding for the question
        question_embedding = await self.embedding_service.get_embedding(
            question_data["question_text"]
        )
        
        # Normalize options
        raw_options = question_data.get("options")
        normalized_options = None
        if raw_options:
            normalized_options = self._normalize_options(raw_options)
        
        # Normalize correct answer
        correct_answer = question_data.get("correct_answer") or question_data.get("expected_answer") or question_data.get("answer")
        if isinstance(correct_answer, dict):
            correct_answer = correct_answer.get("option") or correct_answer.get("value") or str(correct_answer)
        
        question = Question(
            document_id=document_id,
            session_id=session_id,
            subject_id=subject_id,
            topic_id=topic_id,
            question_text=question_data["question_text"],
            question_embedding=question_embedding,
            question_type=question_type,
            marks=marks,
            difficulty_level=(difficulty or "medium")[:20],
            bloom_taxonomy_level=(question_data.get("bloom_taxonomy_level") or "understand")[:30],
            correct_answer=str(correct_answer) if correct_answer else None,
            options=normalized_options,
            explanation=question_data.get("explanation"),
            topic_tags=question_data.get("topic_tags"),
            source_chunk_ids=chunk_ids,
            generation_confidence=confidence_score,
            # Novelty metadata
            novelty_score=novelty_result.novelty_score,
            max_similarity=novelty_result.max_similarity,
            similarity_source=novelty_result.similarity_source,
            generation_attempt_count=attempt_count,
            used_reference_materials=used_reference,
            novelty_metadata=novelty_result.similarity_breakdown,
            generation_status="accepted",
            generation_metadata={
                "raw_response": question_data,
            },
        )
        
        self.db.add(question)
        await self.db.commit()
        await self.db.refresh(question)
        
        # Convert to response
        question_response = QuestionResponse(
            id=question.id,
            document_id=question.document_id,
            subject_id=question.subject_id,
            topic_id=question.topic_id,
            session_id=question.session_id,
            question_text=question.question_text,
            question_type=question.question_type,
            marks=question.marks,
            difficulty_level=question.difficulty_level,
            bloom_taxonomy_level=question.bloom_taxonomy_level,
            options=question.options,
            correct_answer=question.correct_answer,
            explanation=question.explanation,
            topic_tags=question.topic_tags,
            source_chunk_ids=question.source_chunk_ids,
            course_outcome_mapping=question.course_outcome_mapping,
            learning_outcome_id=question.learning_outcome_id,
            vetting_status=question.vetting_status,
            vetted_at=question.vetted_at,
            vetting_notes=question.vetting_notes,
            answerability_score=question.answerability_score,
            specificity_score=question.specificity_score,
            generation_confidence=question.generation_confidence,
            generated_at=question.generated_at,
            times_shown=question.times_shown,
            user_rating=question.user_rating,
            is_archived=question.is_archived,
        )
        
        return question, question_response

    def _distribute_types(
        self,
        total_count: int,
        types: Optional[List[str]],
    ) -> Dict[str, int]:
        """Distribute question count across types."""
        if not types:
            types = ["mcq", "short_answer"]
        
        per_type = total_count // len(types)
        remainder = total_count % len(types)
        
        distribution = {}
        for i, q_type in enumerate(types):
            distribution[q_type] = per_type + (1 if i < remainder else 0)
        
        return distribution

    async def get_questions(
        self,
        user_id: uuid.UUID,
        document_id: Optional[uuid.UUID] = None,
        subject_id: Optional[uuid.UUID] = None,
        topic_id: Optional[uuid.UUID] = None,
        vetting_status: Optional[str] = None,
        page: int = 1,
        limit: int = 20,
        question_type: Optional[str] = None,
        difficulty: Optional[str] = None,
        show_archived: bool = False,
        include_all_versions: bool = False,
    ) -> tuple[List[Question], Dict[str, Any]]:
        """Get questions with pagination and flexible filtering."""
        # Build base query - support both document-based and rubric-based questions
        # Questions can be owned via Document OR via Subject
        query = (
            select(Question)
            .outerjoin(Document, Question.document_id == Document.id)
            .outerjoin(Subject, Question.subject_id == Subject.id)
            .where(
                or_(
                    Document.user_id == user_id,  # Document-based questions
                    Subject.user_id == user_id,   # Rubric-based questions
                )
            )
        )
        
        # Filter archived questions unless explicitly requested
        if not show_archived:
            query = query.where(Question.is_archived == False)
        else:
            # If show_archived is True, only show archived questions
            query = query.where(Question.is_archived == True)
        
        # By default, only show latest versions
        if not include_all_versions:
            query = query.where(Question.is_latest == True)

        # Apply optional filters
        if document_id:
            query = query.where(Question.document_id == document_id)
        if subject_id:
            query = query.where(Question.subject_id == subject_id)
        if topic_id:
            query = query.where(Question.topic_id == topic_id)
        if vetting_status:
            query = query.where(Question.vetting_status == vetting_status)
        if question_type:
            query = query.where(Question.question_type == question_type)
        if difficulty:
            query = query.where(Question.difficulty_level == difficulty)

        # Count total
        count_result = await self.db.execute(
            select(func.count()).select_from(query.subquery())
        )
        total = count_result.scalar_one()

        # Paginate
        offset = (page - 1) * limit
        query = query.offset(offset).limit(limit).order_by(Question.generated_at.desc())
        
        result = await self.db.execute(query)
        questions = result.scalars().all()

        pagination = {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit,
        }

        return questions, pagination

    async def rate_question(
        self,
        question_id: uuid.UUID,
        user_id: uuid.UUID,
        rating: int,
        difficulty_rating: Optional[str] = None,
    ) -> Question:
        """Rate a question."""
        # Get question and verify ownership through document
        result = await self.db.execute(
            select(Question)
            .join(Document)
            .where(
                Question.id == question_id,
                Document.user_id == user_id,
            )
        )
        question = result.scalar_one_or_none()
        
        if not question:
            raise ValueError("Question not found")

        question.user_rating = rating
        question.user_difficulty_rating = difficulty_rating
        question.times_shown += 1
        question.last_shown_at = datetime.now(timezone.utc)
        
        await self.db.commit()
        await self.db.refresh(question)
        
        return question

    async def archive_question(
        self,
        question_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> bool:
        """Archive a question."""
        from sqlalchemy import or_
        # Support both document-based and subject-based questions
        result = await self.db.execute(
            select(Question)
            .outerjoin(Document, Question.document_id == Document.id)
            .outerjoin(Subject, Question.subject_id == Subject.id)
            .where(
                Question.id == question_id,
                or_(
                    Document.user_id == user_id,
                    Subject.user_id == user_id,
                ),
            )
        )
        question = result.scalar_one_or_none()
        
        if not question:
            return False

        question.is_archived = True
        await self.db.commit()
        return True
    
    async def unarchive_question(
        self,
        question_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> bool:
        """Unarchive a question (restore it)."""
        from sqlalchemy import or_
        # Get question and verify ownership through document or subject
        result = await self.db.execute(
            select(Question)
            .outerjoin(Document, Question.document_id == Document.id)
            .outerjoin(Subject, Question.subject_id == Subject.id)
            .where(
                Question.id == question_id,
                or_(
                    Document.user_id == user_id,
                    Subject.user_id == user_id,
                ),
            )
        )
        question = result.scalar_one_or_none()
        if not question:
            return False
        
        question.is_archived = False
        await self.db.commit()
        return True

    async def get_generation_sessions(
        self,
        user_id: uuid.UUID,
        document_id: Optional[uuid.UUID] = None,
        page: int = 1,
        limit: int = 20,
    ) -> tuple[List[GenerationSession], Dict[str, Any]]:
        """Get generation sessions for a user."""
        query = select(GenerationSession).where(GenerationSession.user_id == user_id)
        
        if document_id:
            query = query.where(GenerationSession.document_id == document_id)

        # Count total
        count_result = await self.db.execute(
            select(func.count()).select_from(query.subquery())
        )
        total = count_result.scalar_one()

        # Paginate
        offset = (page - 1) * limit
        query = query.offset(offset).limit(limit).order_by(GenerationSession.started_at.desc())
        
        result = await self.db.execute(query)
        sessions = result.scalars().all()

        pagination = {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit,
        }

        return sessions, pagination

    async def quick_generate(
        self,
        user_id: uuid.UUID,
        document_id: uuid.UUID,
        context: str,
        count: int = 5,
        types: Optional[List[str]] = None,
        difficulty: str = "medium",
        bloom_levels: Optional[List[str]] = None,
        use_query_expansion: bool = False,
        marks_by_type: Optional[dict] = None,
        subject_id: Optional[uuid.UUID] = None,
        topic_id: Optional[uuid.UUID] = None,
    ) -> AsyncGenerator[QuickGenerateProgress, None]:
        """
        Generate questions from an already-processed document with minimal configuration.
        This is the simplified RAG pipeline for quick generation.
        
        Args:
            user_id: User ID
            document_id: Document ID (using ID instead of object to avoid SQLAlchemy session issues)
            context: Context/title provided by user (e.g., "Chapter 5: Data Structures")
            count: Number of questions to generate
            types: Question types to generate
            difficulty: Difficulty level
            bloom_levels: Target Bloom's taxonomy levels
            marks_by_type: Dict mapping question type to marks (e.g., {"mcq": 1, "short_answer": 2, "long_answer": 5})
            subject_id: Subject ID to link questions to
            topic_id: Topic/Chapter ID to link questions to
        """
        if types is None:
            types = ["mcq", "short_answer"]
        
        # Default marks by type if not provided
        if marks_by_type is None:
            marks_by_type = {"mcq": 1, "short_answer": 2, "long_answer": 5}

        # 1. Acquire generation lock
        lock_acquired = await self.redis_service.acquire_generation_lock(
            str(user_id), str(document_id)
        )
        if not lock_acquired:
            yield QuickGenerateProgress(
                status="error",
                progress=0,
                message="Another generation is in progress",
            )
            return

        try:
            import logging
            logger = logging.getLogger(__name__)
            logger.info(f"quick_generate: Starting for user {user_id}, context: {context}, count: {count}, types: {types}")
            
            yield QuickGenerateProgress(
                status="generating",
                progress=10,
                message="Preparing content for question generation...",
                document_id=document_id,
            )

            # 2. Get document chunks
            chunks = await self._get_chunks(document_id)
            logger.info(f"quick_generate: Got {len(chunks) if chunks else 0} chunks")
            if not chunks:
                yield QuickGenerateProgress(
                    status="error",
                    progress=10,
                    message="No document content found for generation",
                    document_id=document_id,
                )
                return

            yield QuickGenerateProgress(
                status="generating",
                progress=20,
                message=f"Generating {count} questions from {len(chunks)} content sections...",
                total_questions=count,
                document_id=document_id,
            )

            # 2b. Collect reference book document IDs to include in search
            reference_doc_ids: List[uuid.UUID] = []
            if subject_id and self.document_service:
                reference_doc_ids = await self.document_service.get_reference_document_ids(
                    user_id=user_id,
                    subject_id=subject_id,
                    index_type="reference_book",
                )
                if reference_doc_ids:
                    logger.info(f"quick_generate: Including {len(reference_doc_ids)} reference book(s) in search")
            
            # Build list of all document IDs to search across
            all_search_doc_ids = [document_id] + reference_doc_ids

            # 3. Create a simple session for tracking
            session = GenerationSession(
                document_id=document_id,
                user_id=user_id,
                subject_id=subject_id,
                topic_id=topic_id,
                generation_method="quick",
                requested_count=count,
                requested_types=types,
                requested_difficulty=difficulty,
                focus_topics=[context],  # Use context as focus topic
                status="in_progress",
                generation_config={
                    "mode": "quick_generate",
                    "context": context,
                    "bloom_levels": bloom_levels,
                },
            )
            self.db.add(session)
            await self.db.commit()
            await self.db.refresh(session)
            
            # Extract session_id immediately to avoid SQLAlchemy lazy-loading issues after rollback
            session_id = session.id

            # 4. Generate questions
            questions_generated = 0
            questions_failed = 0
            generated_embeddings = []  # Track embeddings for deduplication within session
            generated_questions_text = []  # Track question text for diversity hints
            total_question_index = 0  # Global index for diversity hints
            
            # Query variations for chunk selection diversity
            query_aspects = [
                context,  # Original query
                f"{context} definition and concepts",
                f"{context} operations and methods",
                f"{context} advantages disadvantages",
                f"{context} implementation details",
                f"{context} examples and applications",
                f"{context} comparison differences",
                f"{context} performance complexity",
            ]
            
            # Distribute question types
            type_distribution = self._distribute_types(count, types)
            logger.info(f"Type distribution: {type_distribution}")
            
            for q_type, type_count in type_distribution.items():
                logger.info(f"Generating {type_count} questions of type {q_type}")
                for i in range(type_count):
                    try:
                        logger.info(f"Starting generation {i+1}/{type_count} for {q_type}")
                        
                        # Use varied query for diversity in chunk selection
                        varied_query = query_aspects[total_question_index % len(query_aspects)]
                        
                        # Select relevant chunks using hybrid search (semantic + BM25)
                        context_embedding = await self.embedding_service.get_embedding(varied_query)
                        
                        # Use multi-document hybrid search to include reference books
                        candidates = await self.document_service.hybrid_search_multi_document(
                            document_ids=all_search_doc_ids,
                            query=varied_query,
                            query_embedding=context_embedding,
                            top_k=8,  # Get more candidates for variety
                            alpha=0.6,  # Slightly favor semantic search
                        )
                        
                        # Rerank using cross-encoder if available
                        if self.reranker_service and len(candidates) > 3:
                            selected_chunks = self.reranker_service.rerank(
                                query=varied_query,
                                chunks=candidates,
                                top_k=3,
                            )
                        else:
                            # Offset selection for variety
                            offset = (total_question_index % 2) * 2
                            selected_chunks = candidates[offset:offset+3] if len(candidates) > offset + 2 else candidates[:3]
                        
                        logger.info(f"Hybrid search returned {len(selected_chunks)} chunks (query: {varied_query[:50]}...)")
                        
                        if not selected_chunks:
                            logger.warning("No chunks from hybrid search, falling back to random selection")
                            import random
                            selected_chunks = random.sample(chunks, min(3, len(chunks)))

                        logger.info(f"Selected {len(selected_chunks)} chunks for generation")

                        # Generate question with context-aware prompt and diversity hints
                        question_data = await self._generate_quick_question(
                            chunks=selected_chunks,
                            question_type=q_type,
                            difficulty=difficulty,
                            context=context,
                            bloom_levels=bloom_levels,
                            previous_questions=generated_questions_text,
                            question_index=total_question_index,
                        )

                        total_question_index += 1

                        if not question_data:
                            logger.warning(f"Question generation returned None for {q_type}")
                            questions_failed += 1
                            continue
                        
                        q_text = question_data.get('question_text', '')
                        logger.info(f"Question generated: {q_text[:100] if q_text else 'empty'}")

                        # Check for duplicates within this session
                        if generated_embeddings:
                            new_embedding = await self.embedding_service.get_embedding(
                                question_data["question_text"]
                            )
                            similarities = self.embedding_service.compute_similarity_batch(
                                new_embedding, generated_embeddings
                            )
                            if any(s > 0.85 for s in similarities):
                                logger.warning("Question rejected as duplicate")
                                questions_failed += 1
                                continue

                        # Track generated question text for diversity
                        generated_questions_text.append(q_text)

                        # Save question to database (includes validation)
                        try:
                            # Get marks for this question type
                            type_marks = marks_by_type.get(q_type, 1)
                            
                            question, question_response = await self._save_question(
                                document_id=document_id,
                                session_id=session_id,
                                question_data=question_data,
                                question_type=q_type,
                                marks=type_marks,
                                difficulty=difficulty,
                                chunk_ids=[c.id for c in selected_chunks],
                                chunks=selected_chunks,
                                subject_id=subject_id,
                                topic_id=topic_id,
                            )
                            
                            questions_generated += 1
                            generated_embeddings.append(question.question_embedding)
                            logger.info(f"Successfully saved question {question.id} with vetting_status: {question.vetting_status}")

                            # Calculate progress
                            total_attempted = questions_generated + questions_failed
                            progress = 20 + int((total_attempted / count) * 75)

                            yield QuickGenerateProgress(
                                status="generating",
                                progress=min(progress, 95),
                                current_question=questions_generated,
                                total_questions=count,
                                question=question_response,
                                message=f"Generated question {questions_generated}/{count}",
                                document_id=document_id,
                            )
                        except ValueError as ve:
                            # Validation failure, just skip and retry
                            logger.warning(str(ve))
                            questions_failed += 1
                            continue
                        except Exception as save_error:
                            # Rollback this transaction and continue
                            await self.db.rollback()
                            logger.exception(f"Failed to save question: {save_error}")
                            questions_failed += 1
                            continue

                    except Exception as e:
                        logger.exception(f"Exception during question generation: {e}")
                        questions_failed += 1
                        # Continue with next question on error

            # 5. Backfill: try to generate more if we didn't reach the target
            backfill_attempts = 0
            max_backfill = min(questions_failed, 3)  # Try up to 3 backfill attempts
            
            while questions_generated < count and backfill_attempts < max_backfill:
                backfill_attempts += 1
                logger.info(f"Backfill attempt {backfill_attempts}: need {count - questions_generated} more questions")
                
                # Pick a random type to backfill with
                import random
                q_type = random.choice(types)
                
                try:
                    # Use hybrid search with modified context for variety
                    modified_context = f"{context} variation {backfill_attempts}"
                    context_embedding = await self.embedding_service.get_embedding(modified_context)
                    
                    # Get more chunks across primary + reference books
                    all_chunks = await self.document_service.hybrid_search_multi_document(
                        document_ids=all_search_doc_ids,
                        query=modified_context,
                        query_embedding=context_embedding,
                        top_k=6,
                        alpha=0.5,  # Balance semantic and keyword search
                    )
                    
                    # Use different chunks for variety by offsetting
                    offset = backfill_attempts * 2
                    selected_chunks = all_chunks[offset:offset+3] if len(all_chunks) > offset else all_chunks[:3]
                    
                    if not selected_chunks:
                        selected_chunks = random.sample(chunks, min(3, len(chunks)))
                    
                    question_data = await self._generate_quick_question(
                        chunks=selected_chunks,
                        question_type=q_type,
                        difficulty=difficulty,
                        context=context,
                        bloom_levels=bloom_levels,
                        previous_questions=generated_questions_text,
                        question_index=total_question_index + backfill_attempts,
                    )
                    
                    if question_data:
                        # Check for duplicates
                        is_duplicate = False
                        q_text = question_data.get('question_text', '')
                        if generated_embeddings:
                            new_embedding = await self.embedding_service.get_embedding(
                                question_data["question_text"]
                            )
                            similarities = self.embedding_service.compute_similarity_batch(
                                new_embedding, generated_embeddings
                            )
                            is_duplicate = any(s > 0.85 for s in similarities)
                        
                        if not is_duplicate:
                            try:
                                question, question_response = await self._save_question(
                                    document_id=document_id,
                                    session_id=session_id,
                                    question_data=question_data,
                                    question_type=q_type,
                                    marks=None,
                                    difficulty=difficulty,
                                    chunk_ids=[c.id for c in selected_chunks],
                                    chunks=selected_chunks,
                                )
                                questions_generated += 1
                                generated_embeddings.append(question.question_embedding)
                                generated_questions_text.append(q_text)  # Track for diversity
                                logger.info(f"Backfill successful: {questions_generated}/{count} questions")
                                
                                yield QuickGenerateProgress(
                                    status="generating",
                                    progress=min(95, 20 + int((questions_generated / count) * 75)),
                                    current_question=questions_generated,
                                    total_questions=count,
                                    question=question_response,
                                    message=f"Generated question {questions_generated}/{count}",
                                    document_id=document_id,
                                )
                            except Exception as save_error:
                                await self.db.rollback()
                                logger.warning(f"Backfill save failed: {save_error}")
                except Exception as e:
                    logger.warning(f"Backfill attempt {backfill_attempts} failed: {e}")

            # 6. Complete session - re-fetch to avoid expired state after rollbacks
            logger.info(f"Generation complete: {questions_generated} generated, {questions_failed} failed")
            
            # Re-fetch session to ensure we have fresh state after any rollbacks
            session_result = await self.db.execute(
                select(GenerationSession).where(GenerationSession.id == session_id)
            )
            session = session_result.scalar_one_or_none()
            
            if session:
                session.questions_generated = questions_generated
                session.questions_failed = questions_failed
                session.questions_duplicate = 0
                session.status = "completed"
                session.completed_at = datetime.now(timezone.utc)
                if session.started_at:
                    session.total_duration_seconds = (
                        session.completed_at - session.started_at
                    ).total_seconds()
                
                await self.db.commit()

            yield QuickGenerateProgress(
                status="complete",
                progress=100,
                current_question=questions_generated,
                total_questions=count,
                message=f"Successfully generated {questions_generated} questions",
                document_id=document_id,
            )

        except Exception as e:
            # Rollback the session on error
            await self.db.rollback()
            logger.exception(f"Error in quick_generate: {e}")
            
            yield QuickGenerateProgress(
                status="error",
                progress=0,
                message=f"Generation failed: {str(e)}",
                document_id=document_id,
            )

        finally:
            # Release lock
            await self.redis_service.release_generation_lock(
                str(user_id), str(document_id)
            )

    async def _generate_quick_question(
        self,
        chunks: List[DocumentChunk],
        question_type: str,
        difficulty: str,
        context: str,
        bloom_levels: Optional[List[str]] = None,
        previous_questions: Optional[List[str]] = None,
        question_index: int = 0,
    ) -> Optional[Dict[str, Any]]:
        """Generate a single question for quick generation with context awareness."""
        import logging
        logger = logging.getLogger(__name__)
        
        # Build context from chunks
        doc_content = "\n\n---\n\n".join([c.chunk_text for c in chunks])
        logger.info(f"Generating {question_type} question, context length: {len(doc_content)}")
        
        # Select system prompt based on type
        if question_type == "mcq":
            system_prompt = SYSTEM_PROMPT_MCQ
        elif question_type == "short_answer":
            system_prompt = SYSTEM_PROMPT_SHORT
        else:
            system_prompt = SYSTEM_PROMPT_LONG

        # Select Bloom's level
        bloom_level = None
        if bloom_levels:
            import random
            bloom_level = random.choice(bloom_levels)
        else:
            # Elevated defaults for more challenging questions
            bloom_defaults = {
                "mcq": "apply",  # Changed from "understand" to "apply"
                "short_answer": "analyze",  # Changed from "apply" to "analyze"
                "long_answer": "evaluate",  # Changed from "analyze" to "evaluate"
            }
            bloom_level = bloom_defaults.get(question_type, "apply")

        # Build diversity hints based on question index - more challenging patterns
        diversity_hints = [
            "Focus on WHY a specific approach or method is used rather than just WHAT it is",
            "Focus on the RELATIONSHIP between two or more concepts and their interactions",
            "Focus on COMPARING effectiveness or suitability of different approaches",
            "Focus on IMPLICATIONS or CONSEQUENCES of applying/not applying a concept",
            "Focus on PROBLEM-SOLVING: how to apply knowledge to address a specific challenge",
            "Focus on LIMITATIONS or constraints and how to work within them",
            "Focus on TRADE-OFFS: when to choose one approach over another and why",
            "Focus on CRITICAL ANALYSIS: identifying strengths, weaknesses, or potential issues",
        ]
        hint = diversity_hints[question_index % len(diversity_hints)]
        
        # Build exclusion context if we have previous questions
        exclusion_text = ""
        if previous_questions and len(previous_questions) > 0:
            exclusion_text = "\n\nIMPORTANT: Generate a DIFFERENT question. Do NOT ask about:\n" + "\n".join(
                f"- {q[:80]}..." if len(q) > 80 else f"- {q}" 
                for q in previous_questions[-5:]  # Include last 5 questions max
            )
        
        # Build enhanced prompt with user context
        prompt = f"""Topic/Context: {context}

Reference material:
{doc_content}

Generate a {question_type.replace('_', ' ')} question with the following requirements:
- The question should be relevant to the topic: "{context}"
- Difficulty: {difficulty}
- Bloom's Taxonomy Level: {bloom_level}
- {hint}
- The question must be answerable using the knowledge from the reference material
- Write the question AND answer as STANDALONE exam content - do NOT reference "the document", "the passage", "according to the text", "based on the provided content", etc.
- Both question and answer should read naturally as professional exam questions{exclusion_text}

Output valid JSON only."""

        try:
            logger.info(f"Calling LLM for {question_type} question...")
            response = await self._generate_with_retry(
                prompt=prompt,
                system_prompt=system_prompt,
                question_type=question_type,
            )
            
            if not response:
                return None
            
            logger.info(f"LLM response received: {str(response)[:200]}")
            
            # Normalize response keys - LLM might use different key names
            if "question" in response and "question_text" not in response:
                response["question_text"] = response.pop("question")
            if "text" in response and "question_text" not in response:
                response["question_text"] = response.pop("text")
            
            # Validate required field
            if "question_text" not in response:
                logger.warning(f"Response missing question_text: {response.keys()}")
                return None
            
            response["bloom_taxonomy_level"] = bloom_level
            return response
            
        except Exception as e:
            logger.exception(f"Failed to generate question: {e}")
            return None
    
    async def _generate_with_retry(
        self,
        prompt: str,
        system_prompt: str,
        question_type: str,
        max_retries: int = 3,
    ) -> Optional[Dict[str, Any]]:
        """Generate JSON with retry on parse errors."""
        import logging
        logger = logging.getLogger(__name__)
        
        last_error = None
        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    logger.info(f"Retry attempt {attempt + 1}/{max_retries} for {question_type}")
                    # Use lower temperature on retry for more predictable output
                    temperature = max(0.2, 0.85 - (attempt * 0.25))
                else:
                    # Higher base temperature for diversity with smaller models
                    temperature = 0.85
                
                response = await self.llm_service.generate_json(
                    prompt=prompt,
                    system_prompt=system_prompt,
                    temperature=temperature,
                )
                return response
            except Exception as e:
                last_error = e
                logger.warning(f"Attempt {attempt + 1}/{max_retries} failed for {question_type}: {str(e)[:100]}")
        
        # All retries exhausted - log and return None instead of raising
        logger.error(f"All {max_retries} attempts failed for {question_type}: {last_error}")
        return None

    async def quick_generate_with_novelty(
        self,
        user_id: uuid.UUID,
        document_id: uuid.UUID,
        context: str,
        count: int = 5,
        types: Optional[List[str]] = None,
        difficulty: str = "medium",
        bloom_levels: Optional[List[str]] = None,
        marks_by_type: Optional[dict] = None,
        subject_id: Optional[uuid.UUID] = None,
        topic_id: Optional[uuid.UUID] = None,
    ) -> AsyncGenerator[QuickGenerateProgress, None]:
        """
        Generate questions with full novelty validation pipeline.
        
        This method:
        1. Computes novelty score for each generated question
        2. Enforces user's novelty threshold
        3. Uses intelligent regeneration with alternative chunks
        4. Falls back to reference materials when needed
        5. Only returns questions that meet novelty threshold
        
        Args:
            user_id: User ID
            document_id: Document ID
            context: Context/title provided by user
            count: Number of questions to generate
            types: Question types to generate
            difficulty: Difficulty level
            bloom_levels: Target Bloom's taxonomy levels
            marks_by_type: Dict mapping question type to marks
            subject_id: Subject ID to link questions to
            topic_id: Topic/Chapter ID to link questions to
        """
        import logging
        logger = logging.getLogger(__name__)
        
        if types is None:
            types = ["mcq", "short_answer"]
        
        if marks_by_type is None:
            marks_by_type = {"mcq": 1, "short_answer": 2, "long_answer": 5}

        # Acquire generation lock
        lock_acquired = await self.redis_service.acquire_generation_lock(
            str(user_id), str(document_id)
        )
        if not lock_acquired:
            yield QuickGenerateProgress(
                status="error",
                progress=0,
                message="Another generation is in progress",
            )
            return

        try:
            logger.info(f"quick_generate_with_novelty: Starting for user {user_id}, context: {context}")
            
            # Get user's novelty settings
            novelty_settings = await self.novelty_service.get_user_novelty_settings(user_id)
            novelty_threshold = novelty_settings["novelty_threshold"]
            max_attempts = novelty_settings["max_regeneration_attempts"]
            
            logger.info(f"Novelty threshold: {novelty_threshold}, max attempts: {max_attempts}")
            
            yield QuickGenerateProgress(
                status="generating",
                progress=5,
                message=f"Preparing content (novelty threshold: {novelty_threshold:.0%})...",
                document_id=document_id,
            )

            # Get document chunks
            chunks = await self._get_chunks(document_id)
            if not chunks:
                yield QuickGenerateProgress(
                    status="error",
                    progress=5,
                    message="No document content found for generation",
                    document_id=document_id,
                )
                return

            # Collect reference book document IDs to include in search
            reference_doc_ids: List[uuid.UUID] = []
            if subject_id and self.document_service:
                reference_doc_ids = await self.document_service.get_reference_document_ids(
                    user_id=user_id,
                    subject_id=subject_id,
                    index_type="reference_book",
                )
                if reference_doc_ids:
                    logger.info(f"quick_generate_with_novelty: Including {len(reference_doc_ids)} reference book(s) in search")
            all_search_doc_ids = [document_id] + reference_doc_ids

            yield QuickGenerateProgress(
                status="generating",
                progress=10,
                message=f"Generating {count} unique questions from {len(chunks)} content sections...",
                total_questions=count,
                document_id=document_id,
            )

            # Create session for tracking
            session = GenerationSession(
                document_id=document_id,
                user_id=user_id,
                subject_id=subject_id,
                topic_id=topic_id,
                generation_method="quick",
                requested_count=count,
                requested_types=types,
                requested_difficulty=difficulty,
                focus_topics=[context],
                status="in_progress",
                generation_config={
                    "mode": "quick_generate_with_novelty",
                    "context": context,
                    "bloom_levels": bloom_levels,
                    "novelty_threshold": novelty_threshold,
                    "max_regeneration_attempts": max_attempts,
                },
            )
            self.db.add(session)
            await self.db.commit()
            await self.db.refresh(session)
            session_id = session.id

            # Generate questions with novelty validation
            questions_generated = 0
            questions_failed = 0
            questions_discarded = 0  # Questions that failed novelty threshold
            generated_embeddings: List[List[float]] = []
            
            # Distribute question types
            type_distribution = self._distribute_types(count, types)
            
            for q_type, type_count in type_distribution.items():
                for i in range(type_count):
                    logger.info(f"Generating question {i+1}/{type_count} of type {q_type}")
                    
                    try:
                        # Select relevant chunks across primary + reference books
                        context_embedding = await self.embedding_service.get_embedding(context)
                        candidates = await self.document_service.hybrid_search_multi_document(
                            document_ids=all_search_doc_ids,
                            query=context,
                            query_embedding=context_embedding,
                            top_k=6,
                            alpha=0.6,
                        )
                        
                        if self.reranker_service and len(candidates) > 3:
                            selected_chunks = self.reranker_service.rerank(
                                query=context,
                                chunks=candidates,
                                top_k=3,
                            )
                        else:
                            selected_chunks = candidates[:3]
                        
                        if not selected_chunks:
                            import random
                            selected_chunks = random.sample(chunks, min(3, len(chunks)))
                        
                        # Generate with novelty validation
                        type_marks = marks_by_type.get(q_type, 1)
                        
                        question, question_response, embedding = await self._generate_with_novelty_validation(
                            user_id=user_id,
                            document_id=document_id,
                            chunks=selected_chunks,
                            question_type=q_type,
                            difficulty=difficulty,
                            marks=type_marks,
                            bloom_levels=bloom_levels,
                            context=context,
                            session_id=session_id,
                            subject_id=subject_id,
                            topic_id=topic_id,
                            generated_embeddings=generated_embeddings,
                            document_ids=all_search_doc_ids,
                        )
                        
                        if question and question_response:
                            questions_generated += 1
                            generated_embeddings.append(embedding)
                            
                            # Calculate progress
                            total_attempted = questions_generated + questions_failed + questions_discarded
                            progress = 10 + int((total_attempted / count) * 85)
                            
                            yield QuickGenerateProgress(
                                status="generating",
                                progress=min(progress, 95),
                                current_question=questions_generated,
                                total_questions=count,
                                question=question_response,
                                message=f"Generated question {questions_generated}/{count} (novelty: {question.novelty_score:.0%})",
                                document_id=document_id,
                            )
                        else:
                            questions_discarded += 1
                            logger.warning(f"Question discarded after novelty validation")
                            
                    except Exception as e:
                        logger.exception(f"Exception during question generation: {e}")
                        questions_failed += 1
                        await self.db.rollback()

            # Complete session
            session_result = await self.db.execute(
                select(GenerationSession).where(GenerationSession.id == session_id)
            )
            session = session_result.scalar_one_or_none()
            
            if session:
                session.questions_generated = questions_generated
                session.questions_failed = questions_failed + questions_discarded
                session.questions_duplicate = questions_discarded
                session.status = "completed"
                session.completed_at = datetime.now(timezone.utc)
                if session.started_at:
                    session.total_duration_seconds = (
                        session.completed_at - session.started_at
                    ).total_seconds()
                
                await self.db.commit()

            yield QuickGenerateProgress(
                status="complete",
                progress=100,
                current_question=questions_generated,
                total_questions=count,
                message=f"Generated {questions_generated} unique questions" + 
                       (f" ({questions_discarded} below novelty threshold)" if questions_discarded > 0 else ""),
                document_id=document_id,
            )

        except Exception as e:
            await self.db.rollback()
            logger.exception(f"Error in quick_generate_with_novelty: {e}")
            
            yield QuickGenerateProgress(
                status="error",
                progress=0,
                message=f"Generation failed: {str(e)}",
                document_id=document_id,
            )

        finally:
            await self.redis_service.release_generation_lock(
                str(user_id), str(document_id)
            )