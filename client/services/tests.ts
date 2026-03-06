/**
 * Tests API Service - Teacher assessments management
 */

import api from './api';

// Types

export interface DifficultyLevelConfig {
  count: number;
  lo_mapping: string[];
}

export interface TopicSelection {
  topic_id: string;
  count: number;
  topic_name?: string;
}

export interface TestCreateData {
  title: string;
  description?: string;
  instructions?: string;
  subject_id: string;
  generation_type: 'subject_wise' | 'topic_wise' | 'multi_topic';
  difficulty_config?: Record<string, DifficultyLevelConfig>;
  topic_config?: TopicSelection[];
  duration_minutes?: number;
}

export interface TestUpdateData {
  title?: string;
  description?: string;
  instructions?: string;
  duration_minutes?: number;
  difficulty_config?: Record<string, DifficultyLevelConfig>;
  topic_config?: TopicSelection[];
}

export interface TestQuestionUpdateData {
  question_text_override?: string;
  options_override?: string[];
  correct_answer_override?: string;
  marks?: number;
  order_index?: number;
}

export interface TestQuestion {
  id: string;
  test_id: string;
  question_id: string;
  order_index: number;
  marks: number;
  question_text_override?: string | null;
  options_override?: string[] | null;
  correct_answer_override?: string | null;
  question_text: string;
  question_type?: string | null;
  options?: string[] | null;
  correct_answer?: string | null;
  explanation?: string | null;
  difficulty_level?: string | null;
  bloom_taxonomy_level?: string | null;
  topic_name?: string | null;
  learning_outcome_id?: string | null;
}

export interface TestResponse {
  id: string;
  teacher_id: string;
  subject_id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  generation_type: string;
  difficulty_config?: Record<string, DifficultyLevelConfig> | null;
  topic_config?: TopicSelection[] | null;
  total_questions: number;
  total_marks: number;
  duration_minutes?: number | null;
  status: 'draft' | 'published' | 'unpublished' | 'archived';
  published_at?: string | null;
  unpublished_at?: string | null;
  created_at: string;
  updated_at: string;
  subject_name?: string | null;
  subject_code?: string | null;
  submissions_count: number;
  average_score?: number | null;
}

export interface TestDetailResponse extends TestResponse {
  questions: TestQuestion[];
}

export interface TestSubmissionResponse {
  id: string;
  test_id: string;
  student_id: string;
  score: number;
  total_marks: number;
  percentage: number;
  status: string;
  time_taken_seconds?: number | null;
  started_at: string;
  submitted_at?: string | null;
  student_name?: string | null;
  student_username?: string | null;
  answers?: any[] | null;
}

export interface QuestionPerformance {
  question_id: string;
  question_text: string;
  correct_count: number;
  total_attempts: number;
  accuracy: number;
  average_time_seconds?: number | null;
}

export interface TestPerformanceResponse {
  test_id: string;
  test_title: string;
  total_submissions: number;
  average_score: number;
  average_percentage: number;
  highest_score: number;
  lowest_score: number;
  submissions: TestSubmissionResponse[];
  question_performance: QuestionPerformance[];
}

export interface GenerateResult {
  test_id: string;
  questions_added: number;
  total_marks: number;
}

// =============================================================================
// Streaming Exam Types (Real-time question generation via SSE)
// =============================================================================

export interface ExamStartedEvent {
  exam_session_id: string;
  test_title: string;
  subject_name: string;
  total_questions: number;
  duration_minutes: number | null;
}

export interface ExamQuestionEvent {
  index: number;
  question_id: string;
  question_text: string;
  question_type: string;
  options: string[] | null;
  difficulty_level: string | null;
  marks: number;
  total_questions: number;
}

export interface StreamingExamCallbacks {
  onExamStarted?: (data: ExamStartedEvent) => void;
  onQuestionReady?: (data: ExamQuestionEvent) => void;
  onComplete?: (totalGenerated: number) => void;
  onError?: (message: string, fallbackAvailable: boolean) => void;
}

export interface StreamingExamResult {
  exam_session_id: string;
  score: number;
  total_marks: number;
  percentage: number;
  correct_count: number;
  total_questions: number;
  xp_earned: number;
  streak_days: number;
  level_up: boolean;
  new_level: number | null;
  tutor_feedback: string | null;
  answers: {
    question_id: string;
    selected_answer: string;
    is_correct: boolean;
    marks_obtained: number;
    correct_answer: string;
  }[];
}

export interface ExamSessionQuestionDetail {
  question_id: string;
  question_text: string;
  options: string[] | null;
  correct_answer: string | null;
  student_answer: string | null;
  is_correct: boolean | null;
  difficulty_level: string | null;
  marks: number;
}

export interface ExamSessionResponse {
  id: string;
  test_id: string;
  student_id: string;
  student_name: string | null;
  student_username: string | null;
  test_title: string;
  subject_name: string;
  status: string;
  total_questions_planned: number;
  total_questions_generated: number;
  score: number | null;
  total_marks: number | null;
  percentage: number | null;
  started_at: string;
  completed_at: string | null;
  questions: ExamSessionQuestionDetail[];
}

export interface ExamSessionListResponse {
  items: ExamSessionResponse[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Service

export const testsService = {
  // ========================
  // Teacher: Test CRUD
  // ========================

  async createTest(data: TestCreateData): Promise<TestResponse> {
    const response = await api.post<TestResponse>('/tests', data);
    return response.data;
  },

  async listTests(status?: string): Promise<TestResponse[]> {
    const params = status ? { status } : {};
    const response = await api.get<TestResponse[]>('/tests', { params });
    return response.data;
  },

  async getTest(testId: string): Promise<TestDetailResponse> {
    const response = await api.get<TestDetailResponse>(`/tests/${testId}`);
    return response.data;
  },

  async updateTest(testId: string, data: TestUpdateData): Promise<TestResponse> {
    const response = await api.put<TestResponse>(`/tests/${testId}`, data);
    return response.data;
  },

  async deleteTest(testId: string): Promise<void> {
    await api.delete(`/tests/${testId}`);
  },

  // ========================
  // Teacher: Generate Questions
  // ========================

  async generateQuestions(testId: string): Promise<GenerateResult> {
    const response = await api.post<GenerateResult>(
      `/tests/${testId}/generate`,
      {},
      { timeout: 1000000 } // 16 min timeout for LLM generation
    );
    return response.data;
  },

  // ========================
  // Teacher: Publish/Unpublish
  // ========================

  async publishTest(testId: string): Promise<{ status: string; published_at: string }> {
    const response = await api.post(`/tests/${testId}/publish`);
    return response.data;
  },

  async unpublishTest(testId: string): Promise<{ status: string }> {
    const response = await api.post(`/tests/${testId}/unpublish`);
    return response.data;
  },

  // ========================
  // Teacher: Question Management
  // ========================

  async updateTestQuestion(
    testId: string,
    testQuestionId: string,
    data: TestQuestionUpdateData
  ): Promise<any> {
    const response = await api.put(`/tests/${testId}/questions/${testQuestionId}`, data);
    return response.data;
  },

  async removeTestQuestion(testId: string, testQuestionId: string): Promise<void> {
    await api.delete(`/tests/${testId}/questions/${testQuestionId}`);
  },

  // ========================
  // Teacher: Performance
  // ========================

  async getTestPerformance(testId: string): Promise<TestPerformanceResponse> {
    const response = await api.get<TestPerformanceResponse>(`/tests/${testId}/performance`);
    return response.data;
  },

  // ========================
  // Student: Available Tests
  // ========================

  async getStudentTests(): Promise<any[]> {
    const response = await api.get('/tests/student/available');
    return response.data;
  },

  async getStudentTest(testId: string): Promise<any> {
    const response = await api.get(`/tests/student/${testId}`);
    return response.data;
  },

  async submitTest(
    testId: string,
    answers: { question_id: string; selected_answer: string; time_taken_seconds?: number }[],
    totalTimeSeconds?: number
  ): Promise<any> {
    const response = await api.post('/tests/student/submit', {
      test_id: testId,
      answers,
      total_time_seconds: totalTimeSeconds,
    });
    return response.data;
  },

  // ========================
  // Student: Streaming Exam (Real-time question generation)
  // ========================

  /**
   * Start a streaming exam with real-time question generation via SSE.
   * Questions are generated one-at-a-time as the student answers.
   */
  startStreamingExam(
    testId: string,
    callbacks: StreamingExamCallbacks
  ): EventSource {
    const EventSourceImpl = require('react-native-sse').default;
    const { tokenStorage } = require('./api');

    const token = tokenStorage.getAccessTokenSync?.() || '';
    const baseURL = api.defaults.baseURL || '';

    const eventSource = new EventSourceImpl(
      `${baseURL}/tests/student/${testId}/stream-exam`,
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
              test_title: data.test_title,
              subject_name: data.subject_name,
              total_questions: data.total_questions,
              duration_minutes: data.duration_minutes,
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
            callbacks.onError?.(data.message, data.fallback_available);
            eventSource.close();
            break;
        }
      } catch (e) {
        console.error('Failed to parse SSE event:', e);
      }
    });

    eventSource.addEventListener('error', (event: any) => {
      callbacks.onError?.('Connection error', false);
      eventSource.close();
    });

    return eventSource;
  },

  /**
   * Submit answers for a streaming exam session.
   */
  async submitStreamingExam(
    examSessionId: string,
    answers: { question_id: string; selected_answer: string }[],
    totalTimeSeconds?: number
  ): Promise<StreamingExamResult> {
    const response = await api.post<StreamingExamResult>('/tests/student/stream-exam/submit', {
      exam_session_id: examSessionId,
      answers,
      total_time_seconds: totalTimeSeconds,
    });
    return response.data;
  },

  // ========================
  // Teacher: Exam Sessions History
  // ========================

  /**
   * Get all streaming exam sessions for a test (teacher view).
   */
  async getExamSessions(
    testId: string,
    page: number = 1,
    pageSize: number = 20,
    status?: string
  ): Promise<ExamSessionListResponse> {
    const params: Record<string, any> = { page, page_size: pageSize };
    if (status) params.status = status;
    
    const response = await api.get<ExamSessionListResponse>(
      `/tests/${testId}/exam-sessions`,
      { params }
    );
    return response.data;
  },
};

export default testsService;
