"""
Test-related Pydantic schemas.
"""

from datetime import datetime
from typing import Optional, List, Dict
from pydantic import BaseModel, Field
from uuid import UUID


# --- Difficulty Level Config ---

class DifficultyLevelConfig(BaseModel):
    count: int = Field(..., ge=1, le=100, description="Number of questions at this level")
    lo_mapping: List[str] = Field(default_factory=list, description="Learning outcome IDs for this level")


class DifficultyConfig(BaseModel):
    easy: Optional[DifficultyLevelConfig] = None
    medium: Optional[DifficultyLevelConfig] = None
    hard: Optional[DifficultyLevelConfig] = None


# --- Topic Config ---

class TopicSelection(BaseModel):
    topic_id: UUID
    count: int = Field(..., ge=1, le=100)
    topic_name: Optional[str] = None


# --- Test Create ---

class TestCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    instructions: Optional[str] = None
    subject_id: UUID
    generation_type: str = Field("subject_wise", pattern=r"^(subject_wise|topic_wise|multi_topic)$")
    difficulty_config: Optional[Dict[str, DifficultyLevelConfig]] = None
    topic_config: Optional[List[TopicSelection]] = None
    duration_minutes: Optional[int] = Field(None, ge=1, le=600)


class TestUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    instructions: Optional[str] = None
    duration_minutes: Optional[int] = Field(None, ge=1, le=600)
    difficulty_config: Optional[Dict[str, DifficultyLevelConfig]] = None
    topic_config: Optional[List[TopicSelection]] = None


# --- Test Question ---

class TestQuestionUpdate(BaseModel):
    """Update a specific question within a test."""
    question_text_override: Optional[str] = None
    options_override: Optional[List[str]] = None
    correct_answer_override: Optional[str] = None
    marks: Optional[int] = Field(None, ge=1, le=100)
    order_index: Optional[int] = Field(None, ge=0)


class TestQuestionResponse(BaseModel):
    id: UUID
    test_id: UUID
    question_id: UUID
    order_index: int = 0
    marks: int = 1
    question_text_override: Optional[str] = None
    options_override: Optional[List[str]] = None
    correct_answer_override: Optional[str] = None
    # Original question data
    question_text: str
    question_type: Optional[str] = None
    options: Optional[List[str]] = None
    correct_answer: Optional[str] = None
    explanation: Optional[str] = None
    difficulty_level: Optional[str] = None
    bloom_taxonomy_level: Optional[str] = None
    topic_name: Optional[str] = None
    learning_outcome_id: Optional[str] = None

    model_config = {"from_attributes": True}


# --- Test Response ---

class TestResponse(BaseModel):
    id: UUID
    teacher_id: UUID
    subject_id: UUID
    title: str
    description: Optional[str] = None
    instructions: Optional[str] = None
    generation_type: str
    difficulty_config: Optional[dict] = None
    topic_config: Optional[list] = None
    total_questions: int = 0
    total_marks: int = 0
    duration_minutes: Optional[int] = None
    status: str = "draft"
    published_at: Optional[datetime] = None
    unpublished_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    # Extra info
    subject_name: Optional[str] = None
    subject_code: Optional[str] = None
    submissions_count: int = 0
    average_score: Optional[float] = None

    model_config = {"from_attributes": True}


class TestDetailResponse(TestResponse):
    questions: List[TestQuestionResponse] = []


# --- Test Submission ---

class SubmitAnswer(BaseModel):
    question_id: UUID
    selected_answer: str = Field(..., min_length=1, max_length=5000)
    time_taken_seconds: Optional[int] = Field(None, ge=0, le=36000)


class TestSubmissionCreate(BaseModel):
    test_id: UUID
    answers: List[SubmitAnswer] = Field(..., min_length=1, max_length=200)
    total_time_seconds: Optional[int] = Field(None, ge=0, le=36000)


class AnswerResultResponse(BaseModel):
    question_id: UUID
    is_correct: bool
    correct_answer: str
    marks_obtained: int = 0
    explanation: Optional[str] = None


class TestSubmissionResponse(BaseModel):
    id: UUID
    test_id: UUID
    student_id: UUID
    score: int = 0
    total_marks: int = 0
    percentage: float = 0.0
    status: str = "submitted"
    time_taken_seconds: Optional[int] = None
    started_at: datetime
    submitted_at: Optional[datetime] = None
    # Student info (for teacher view)
    student_name: Optional[str] = None
    student_username: Optional[str] = None
    answers: Optional[list] = None

    model_config = {"from_attributes": True}


# --- Performance Analytics ---

class QuestionPerformance(BaseModel):
    question_id: UUID
    question_text: str
    correct_count: int = 0
    total_attempts: int = 0
    accuracy: float = 0.0
    average_time_seconds: Optional[float] = None


class TestPerformanceResponse(BaseModel):
    test_id: UUID
    test_title: str
    total_submissions: int = 0
    average_score: float = 0.0
    average_percentage: float = 0.0
    highest_score: int = 0
    lowest_score: int = 0
    submissions: List[TestSubmissionResponse] = []
    question_performance: List[QuestionPerformance] = []


# --- Generate from existing questions ---

class GenerateTestRequest(BaseModel):
    """Request to generate test from existing approved questions."""
    test_id: UUID


# =============================================================================
# Streaming Exam Schemas (Real-time question generation via SSE)
# =============================================================================

class ExamStartedEvent(BaseModel):
    """SSE event sent when streaming exam begins."""
    event: str = "exam_started"
    exam_session_id: str
    test_title: str
    subject_name: str
    total_questions: int
    duration_minutes: Optional[int] = None


class ExamQuestionEvent(BaseModel):
    """SSE event sent when a question is ready."""
    event: str = "question_ready"
    index: int  # 0-based question index
    question_id: str
    question_text: str
    question_type: str  # mcq, short_answer, etc.
    options: Optional[List[str]] = None
    difficulty_level: Optional[str] = None
    marks: int = 1
    total_questions: int


class ExamCompleteEvent(BaseModel):
    """SSE event sent when all questions have been generated."""
    event: str = "exam_complete"
    total_generated: int


class ExamErrorEvent(BaseModel):
    """SSE event sent when an error occurs during generation."""
    event: str = "generation_error"
    message: str
    fallback_available: bool = False


# --- Exam Session Submission ---

class ExamAnswerSubmit(BaseModel):
    """Single answer in streaming exam submission."""
    question_id: UUID
    selected_answer: str


class StreamingExamSubmit(BaseModel):
    """Submit answers for a streaming exam."""
    exam_session_id: UUID
    answers: List[ExamAnswerSubmit]
    total_time_seconds: Optional[int] = None


class ExamResultResponse(BaseModel):
    """Result of a streaming exam submission."""
    exam_session_id: UUID
    score: int
    total_marks: int
    percentage: float
    correct_count: int
    total_questions: int
    xp_earned: int
    streak_days: int
    level_up: bool = False
    new_level: Optional[int] = None
    answers: List[dict]  # With is_correct, correct_answer for each


# --- Teacher View: Exam Sessions ---

class ExamSessionQuestionDetail(BaseModel):
    """Question detail for teacher exam session view."""
    question_id: str
    question_text: str
    options: Optional[List[str]] = None
    correct_answer: Optional[str] = None
    student_answer: Optional[str] = None
    is_correct: Optional[bool] = None
    difficulty_level: Optional[str] = None
    marks: int = 1


class ExamSessionResponse(BaseModel):
    """Full exam session detail for teachers."""
    id: UUID
    test_id: UUID
    student_id: UUID
    student_name: Optional[str] = None
    student_username: Optional[str] = None
    test_title: str
    subject_name: str
    status: str
    total_questions_planned: int
    total_questions_generated: int
    score: Optional[int] = None
    total_marks: Optional[int] = None
    percentage: Optional[float] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
    questions: List[ExamSessionQuestionDetail] = []

    model_config = {"from_attributes": True}


class ExamSessionListResponse(BaseModel):
    """Paginated list of exam sessions."""
    items: List[ExamSessionResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
