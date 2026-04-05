/**
 * Learning & Gamification API service
 */
import api from './api';

// Types

export interface SubjectStudent {
  id: string;
  name: string;
  code: string;
  description?: string;
  teacher_name?: string;
  total_topics: number;
  total_questions: number;
  is_enrolled: boolean;
  enrollment_status?: string; // pending, approved, rejected, or null
  mastery: number;
  xp_earned: number;
}

export interface Enrollment {
  id: string;
  student_id: string;
  subject_id: string;
  enrolled_at: string;
  is_active: boolean;
  status: string;
  subject_name?: string;
  subject_code?: string;
}

export interface LessonQuestion {
  id: string;
  question_text: string;
  question_type?: string;
  options?: string[];
  difficulty_level?: string;
  bloom_taxonomy_level?: string;
  marks?: number;
  topic_id?: string;
}

export interface LessonData {
  subject_id: string;
  topic_id?: string;
  topic_name?: string;
  difficulty: string;
  questions: LessonQuestion[];
  total_questions: number;
  hearts_remaining: number;
}

export interface AnswerSubmission {
  question_id: string;
  selected_answer: string;
  time_taken_seconds?: number;
}

export interface AnswerResult {
  question_id: string;
  is_correct: boolean;
  correct_answer: string;
  xp_earned: number;
  explanation?: string;
}

export interface LessonResult {
  score: number;
  total_marks: number;
  total_questions: number;
  correct_answers: number;
  xp_earned: number;
  streak_maintained: boolean;
  new_streak_count: number;
  hearts_remaining: number;
  mastery_change: number;
  new_mastery: number;
  level_up: boolean;
  new_level: number;
  results: AnswerResult[];
  accuracy: number;
  tutor_feedback?: string;
}

export interface StudentProgress {
  id: string;
  student_id: string;
  subject_id: string;
  topic_id?: string;
  topic_name?: string;
  topic_mastery: number;
  xp_earned: number;
  current_level: number;
  accuracy_percentage: number;
  questions_attempted: number;
  questions_correct: number;
  current_difficulty: string;
}

export interface GamificationProfile {
  user_id: string;
  username: string;
  full_name?: string;
  avatar_url?: string;
  role: string;
  xp_total: number;
  streak_count: number;
  hearts: number;
  current_level: number;
  badges: string[];
  subjects_enrolled: number;
  total_lessons_completed: number;
  total_questions_answered: number;
  overall_accuracy: number;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  full_name?: string;
  avatar_url?: string;
  xp_total: number;
  streak_count: number;
  level: number;
}

export interface LeaderboardData {
  entries: LeaderboardEntry[];
  total_students: number;
  current_user_rank?: number;
}

export interface TestHistoryEntry {
  id: string;
  student_id: string;
  subject_id: string;
  topic_id?: string;
  score: number;
  total_marks: number;
  total_questions: number;
  correct_answers: number;
  xp_earned: number;
  time_taken_seconds?: number;
  difficulty: string;
  created_at: string;
}

export interface DailyActivityEntry {
  id: string;
  student_id: string;
  activity_date: string;
  xp_earned: number;
  questions_answered: number;
  correct_answers: number;
  time_spent_seconds: number;
  lessons_completed: number;
}

export interface HeartsData {
  hearts: number;
  max_hearts: number;
}

// API Methods

const learnService = {
  // Subjects
  async getAvailableSubjects(): Promise<SubjectStudent[]> {
    const { data } = await api.get('/learn/subjects');
    return data;
  },

  // Topics for enrolled subjects (student-accessible)
  async getTopics(subjectId: string): Promise<{ topics: { id: string; name: string; description?: string; order_index: number; has_syllabus: boolean; syllabus_content?: string; total_questions: number }[] }> {
    const { data } = await api.get(`/learn/topics/${subjectId}`);
    return data;
  },

  // Student-accessible reference materials (only is_public=true docs)
  async getStudentReferences(subjectId: string): Promise<{ reference_books: any[]; template_papers: any[]; reference_questions: any[] }> {
    const { data } = await api.get(`/learn/references/${subjectId}`);
    return data;
  },

  // Enrollment
  async enrollInSubject(subjectId: string): Promise<Enrollment> {
    const { data } = await api.post('/learn/enroll', { subject_id: subjectId });
    return data;
  },

  async getEnrollments(): Promise<Enrollment[]> {
    const { data } = await api.get('/learn/enrollments');
    return data;
  },

  async getAllEnrollments(): Promise<Enrollment[]> {
    const { data } = await api.get('/learn/enrollments/all');
    return data;
  },

  // Lessons
  async getLesson(subjectId: string, topicId?: string, count: number = 10): Promise<LessonData> {
    const params: Record<string, string | number> = { count };
    if (topicId) params.topic_id = topicId;
    const { data } = await api.get(`/learn/lesson/${subjectId}`, { params });
    return data;
  },

  async submitLesson(submission: {
    subject_id: string;
    topic_id?: string;
    answers: AnswerSubmission[];
    total_time_seconds?: number;
  }): Promise<LessonResult> {
    const { data } = await api.post('/learn/lesson/submit', submission);
    return data;
  },

  // Progress
  async getSubjectProgress(subjectId: string): Promise<StudentProgress[]> {
    const { data } = await api.get(`/learn/progress/${subjectId}`);
    return data;
  },

  // Profile
  async getProfile(): Promise<GamificationProfile> {
    const { data } = await api.get('/learn/profile');
    return data;
  },

  // Leaderboard
  async getLeaderboard(limit: number = 20, subjectId?: string): Promise<LeaderboardData> {
    const params: Record<string, string | number> = { limit };
    if (subjectId) params.subject_id = subjectId;
    const { data } = await api.get('/learn/leaderboard', { params });
    return data;
  },

  // History
  async getTestHistory(subjectId?: string, limit: number = 20): Promise<TestHistoryEntry[]> {
    const params: Record<string, string | number> = { limit };
    if (subjectId) params.subject_id = subjectId;
    const { data } = await api.get('/learn/history', { params });
    return data;
  },

  // Activity
  async getDailyActivity(days: number = 30): Promise<DailyActivityEntry[]> {
    const { data } = await api.get('/learn/activity', { params: { days } });
    return data;
  },

  // Hearts
  async getHearts(): Promise<HeartsData> {
    const { data } = await api.get('/learn/hearts');
    return data;
  },
};

export default learnService;
