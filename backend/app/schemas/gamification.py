"""
Gamification schemas for the learning platform.
"""

from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, Field
from uuid import UUID


# --- Enrollment ---

class EnrollmentCreate(BaseModel):
    subject_id: UUID


class EnrollmentResponse(BaseModel):
    id: UUID
    student_id: UUID
    subject_id: UUID
    enrolled_at: datetime
    is_active: bool
    status: str = "pending"
    subject_name: Optional[str] = None
    subject_code: Optional[str] = None

    model_config = {"from_attributes": True}


class PendingEnrollmentResponse(BaseModel):
    id: UUID
    student_id: UUID
    student_name: Optional[str] = None
    student_email: Optional[str] = None
    subject_id: UUID
    subject_name: Optional[str] = None
    enrolled_at: datetime
    status: str


class EnrollmentActionRequest(BaseModel):
    action: str  # "approve" or "reject"


# --- Student Progress ---

class StudentProgressResponse(BaseModel):
    id: UUID
    student_id: UUID
    subject_id: UUID
    topic_id: Optional[UUID] = None
    topic_name: Optional[str] = None
    topic_mastery: float = 0.0
    xp_earned: int = 0
    current_level: int = 1
    accuracy_percentage: float = 0.0
    questions_attempted: int = 0
    questions_correct: int = 0
    current_difficulty: str = "easy"

    model_config = {"from_attributes": True}


# --- Lesson / Quiz ---

class LessonQuestion(BaseModel):
    id: UUID
    question_text: str
    question_type: Optional[str] = "mcq"
    options: Optional[List[str]] = None
    difficulty_level: Optional[str] = None
    bloom_taxonomy_level: Optional[str] = None
    marks: Optional[int] = 1
    topic_id: Optional[UUID] = None


class LessonResponse(BaseModel):
    subject_id: UUID
    topic_id: Optional[UUID] = None
    topic_name: Optional[str] = None
    difficulty: str = "easy"
    questions: List[LessonQuestion] = []
    total_questions: int = 0
    hearts_remaining: int = 5


class AnswerSubmission(BaseModel):
    question_id: UUID
    selected_answer: str = Field(..., min_length=1, max_length=5000)
    time_taken_seconds: Optional[int] = Field(None, ge=0, le=36000)


class AnswerResult(BaseModel):
    question_id: UUID
    is_correct: bool
    correct_answer: str
    xp_earned: int = 0
    explanation: Optional[str] = None


class LessonSubmission(BaseModel):
    subject_id: UUID
    topic_id: Optional[UUID] = None
    answers: List[AnswerSubmission] = Field(..., min_length=1, max_length=100)
    total_time_seconds: Optional[int] = Field(None, ge=0, le=36000)


class LessonResult(BaseModel):
    score: int
    total_marks: int
    total_questions: int
    correct_answers: int
    xp_earned: int
    streak_maintained: bool
    new_streak_count: int
    hearts_remaining: int
    mastery_change: float
    new_mastery: float
    level_up: bool
    new_level: int
    results: List[AnswerResult]
    accuracy: float
    tutor_feedback: Optional[str] = None


# --- Test History ---

class TestHistoryResponse(BaseModel):
    id: UUID
    student_id: UUID
    subject_id: UUID
    topic_id: Optional[UUID] = None
    score: int
    total_marks: int
    total_questions: int
    correct_answers: int
    xp_earned: int
    time_taken_seconds: Optional[int] = None
    difficulty: str
    tutor_feedback: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Daily Activity ---

class DailyActivityResponse(BaseModel):
    id: UUID
    student_id: UUID
    activity_date: date
    xp_earned: int = 0
    questions_answered: int = 0
    correct_answers: int = 0
    time_spent_seconds: int = 0
    lessons_completed: int = 0

    model_config = {"from_attributes": True}


# --- Gamification Profile ---

class GamificationProfile(BaseModel):
    user_id: UUID
    username: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str
    xp_total: int = 0
    streak_count: int = 0
    hearts: int = 5
    current_level: int = 1
    badges: List[str] = []
    subjects_enrolled: int = 0
    total_lessons_completed: int = 0
    total_questions_answered: int = 0
    overall_accuracy: float = 0.0


class LeaderboardEntry(BaseModel):
    rank: int
    user_id: UUID
    username: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    xp_total: int = 0
    streak_count: int = 0
    level: int = 1


class LeaderboardResponse(BaseModel):
    entries: List[LeaderboardEntry]
    total_students: int
    current_user_rank: Optional[int] = None


# --- Subject for students ---

class SubjectListStudent(BaseModel):
    id: UUID
    name: str
    code: str
    description: Optional[str] = None
    teacher_name: Optional[str] = None
    total_topics: int = 0
    total_questions: int = 0
    is_enrolled: bool = False
    enrollment_status: Optional[str] = None  # pending, approved, rejected, or None
    mastery: float = 0.0
    xp_earned: int = 0

    model_config = {"from_attributes": True}
