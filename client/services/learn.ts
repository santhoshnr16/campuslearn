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

// Streaming Chapter Test Types

export interface ChapterExamStartedEvent {
  exam_session_id: string;
  topic_name: string;
  subject_name: string;
  total_questions: number;
}

export interface ChapterQuestionEvent {
  index: number;
  question_id: string;
  question_text: string;
  question_type: string;
  options: string[] | null;
  difficulty_level: string | null;
  marks: number;
  total_questions: number;
}

export interface StreamingChapterCallbacks {
  onExamStarted?: (data: ChapterExamStartedEvent) => void;
  onQuestionReady?: (data: ChapterQuestionEvent) => void;
  onComplete?: (totalGenerated: number) => void;
  onError?: (message: string) => void;
}

export interface ChapterTestResult {
  exam_session_id: string;
  score: number;
  total_marks: number;
  total_questions: number;
  correct_answers: number;
  accuracy: number;
  xp_earned: number;
  tutor_feedback?: string;
  results: {
    question_id: string;
    selected_answer: string;
    correct_answer: string;
    is_correct: boolean;
    marks: number;
  }[];
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

  // ========================
  // Streaming Chapter Tests
  // ========================

  /**
   * Start a streaming chapter test with real-time question generation via SSE.
   * Questions are generated one-at-a-time as the student answers.
   */
  startStreamingChapterTest(
    subjectId: string,
    topicId: string,
    count: number,
    callbacks: StreamingChapterCallbacks
  ): any {
    const EventSourceImpl = require('react-native-sse').default;
    const { tokenStorage } = require('./api');

    const token = tokenStorage.getAccessTokenSync?.() || '';
    const baseURL = api.defaults.baseURL || '';

    const eventSource = new EventSourceImpl(
      `${baseURL}/learn/chapter/${subjectId}/stream?topic_id=${topicId}&count=${count}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
      }
    );

    eventSource.addEventListener('message', (event: any) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.event) {
          case 'exam_started':
            callbacks.onExamStarted?.({
              exam_session_id: data.exam_session_id,
              topic_name: data.topic_name,
              subject_name: data.subject_name,
              total_questions: data.total_questions,
            });
            break;
          
          case 'question_ready':
            callbacks.onQuestionReady?.({
              index: data.index,
              question_id: data.question_id,
              question_text: data.question_text,
              question_type: data.question_type,
              options: data.options,
              difficulty_level: data.difficulty_level,
              marks: data.marks,
              total_questions: data.total_questions,
            });
            break;
          
          case 'exam_complete':
            callbacks.onComplete?.(data.total_generated);
            eventSource.close();
            break;
          
          case 'generation_error':
            callbacks.onError?.(data.message || 'Question generation failed');
            eventSource.close();
            break;
        }
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    });

    eventSource.addEventListener('error', (error: any) => {
      console.error('SSE error:', error);
      callbacks.onError?.('Connection lost');
      eventSource.close();
    });

    return eventSource;
  },

  /**
   * Submit answers for a streaming chapter test.
   */
  async submitChapterTest(
    examSessionId: string,
    answers: { question_id: string; selected_answer: string }[],
    totalTimeSeconds?: number
  ): Promise<ChapterTestResult> {
    const params = new URLSearchParams();
    params.append('exam_session_id', examSessionId);
    if (totalTimeSeconds) params.append('total_time_seconds', totalTimeSeconds.toString());
    
    const { data } = await api.post(`/learn/chapter/submit?${params.toString()}`, answers);
    return data;
  },

  // ========================
  // Teacher: Chapter Test Sessions
  // ========================

  /**
   * Get chapter test sessions for a subject (teacher view).
   */
  async getChapterSessions(
    subjectId: string,
    options?: {
      topicId?: string;
      page?: number;
      pageSize?: number;
      status?: string;
    }
  ): Promise<{
    items: ChapterSessionResponse[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
  }> {
    const params: Record<string, string | number> = {};
    if (options?.topicId) params.topic_id = options.topicId;
    if (options?.page) params.page = options.page;
    if (options?.pageSize) params.page_size = options.pageSize;
    if (options?.status) params.status = options.status;
    
    const { data } = await api.get(`/learn/teacher/chapter-sessions/${subjectId}`, { params });
    return data;
  },
};

// Response types for teacher endpoints
export interface ChapterSessionQuestion {
  question_id: string;
  question_text: string;
  options: string[] | null;
  correct_answer: string | null;
  student_answer: string | null;
  is_correct: boolean | null;
  difficulty_level: string | null;
  marks: number;
}

export interface ChapterSessionResponse {
  id: string;
  student_id: string;
  student_name: string | null;
  student_username: string | null;
  topic_id: string | null;
  topic_name: string;
  status: string;
  total_questions_planned: number;
  total_questions_generated: number;
  score: number | null;
  total_marks: number | null;
  percentage: number | null;
  started_at: string | null;
  completed_at: string | null;
  questions: ChapterSessionQuestion[];
}

export default learnService;
