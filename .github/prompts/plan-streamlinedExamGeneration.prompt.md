# Plan: Streamlined Exam Generation + Duolingo-style Animations

## Overview

Transform the student exam experience into a real-time, AI-streamed question flow with Duolingo-inspired UI transitions. Questions are generated on-demand when a student clicks "Start Exam" — the first question appears instantly, and subsequent questions generate in the background while the student answers. All generated questions are auto-approved (no vetting). Teacher test history records all student-generated questions for review.

---

## Part 1: Backend — On-Demand Streaming Question Generation

### 1.1 New SSE Endpoint: `POST /api/v1/tests/student/{test_id}/stream-exam`

**File:** `backend/app/api/v1/endpoints/tests.py`

- New endpoint that accepts a student's test start request
- Returns an SSE `StreamingResponse` that:
  1. Sends `event: exam_started` with exam metadata (test title, subject, total planned questions, duration)
  2. Calls `QuestionService` to generate question #1 using the test's subject/topic/difficulty config
  3. Sends `event: question_ready` with the full question payload (question_text, options, difficulty, index) — **no correct_answer included**
  4. Immediately begins generating question #2 in the background
  5. Each subsequent question is sent via `event: question_ready` as it's generated
  6. After all questions generated, sends `event: exam_complete`
- Error recovery: `event: generation_error` with fallback to pre-existing approved questions from the pool
- All generated questions are saved with `vetting_status='approved'` immediately
- A new `ExamSession` record tracks which student got which generated questions

**Key Design Decisions:**
- Questions are MCQ-only for streaming exams (faster generation, instant validation)
- Generate 1 question at a time in sequence (not batch) for lowest latency to first question
- Use the existing RAG pipeline (chunk retrieval → LLM generation) but with a streamlined single-question prompt
- Each question gets a unique `exam_session_id` linking it to this specific exam attempt

### 1.2 New Model: `ExamSession`

**File:** `backend/app/models/test.py`

```python
class ExamSession(Base):
    __tablename__ = "exam_sessions"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    test_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tests.id"))
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subjects.id"))
    
    status: Mapped[str] = mapped_column(String(20), default="in_progress")  # in_progress, completed, abandoned
    total_questions_planned: Mapped[int] = mapped_column(Integer, default=10)
    total_questions_generated: Mapped[int] = mapped_column(Integer, default=0)
    
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    
    # JSON array of generated question IDs in order
    question_ids: Mapped[list] = mapped_column(JSON, default=list)
    
    # Student's answers and scores
    answers: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_marks: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
```

### 1.3 New Schema: `ExamStreamEvent`

**File:** `backend/app/schemas/test.py`

```python
class ExamStartedEvent(BaseModel):
    event: str = "exam_started"
    exam_session_id: str
    test_title: str
    subject_name: str
    total_questions: int
    duration_minutes: int | None

class ExamQuestionEvent(BaseModel):
    event: str = "question_ready"
    index: int  # 0-based question number
    question_id: str
    question_text: str
    question_type: str
    options: list[str] | None
    difficulty_level: str | None
    marks: int
    total_questions: int

class ExamCompleteEvent(BaseModel):
    event: str = "exam_complete"
    total_generated: int
```

### 1.4 Service Method: `TestService.stream_exam_questions()`

**File:** `backend/app/services/test_service.py`

```python
async def stream_exam_questions(self, test_id, student_id) -> AsyncGenerator:
    """Generate questions one-at-a-time via SSE for a student exam."""
    # 1. Validate test is published & student is enrolled
    # 2. Create ExamSession record
    # 3. Determine generation config from test (difficulty_config, topic_config, subject_id)
    # 4. For each planned question:
    #    a. Select relevant document chunks (hybrid search)
    #    b. Call LLM to generate 1 question
    #    c. Save question with vetting_status='approved'
    #    d. Link to ExamSession
    #    e. Yield SSE event
    # 5. Yield exam_complete event
```

### 1.5 Auto-Approve All Generated Questions

**File:** `backend/app/services/question_service.py`

- Modify `_save_question()` / the generation pipeline so that all newly generated questions are saved with `vetting_status = 'approved'` by default
- This applies globally — no vetting workflow needed for now
- The existing vetting endpoints remain but are effectively bypassed

### 1.6 New Submission Endpoint: `POST /api/v1/tests/student/stream-exam/submit`

**File:** `backend/app/api/v1/endpoints/tests.py`

- Accepts `exam_session_id` + answers array
- Scores the exam using the correct answers from the generated questions
- Updates `ExamSession` with score, answers, completed_at
- Awards XP/streaks/hearts via `GamificationService`
- Records in `TestHistory` for teacher visibility
- Returns result with score, XP earned, feedback

---

## Part 2: Backend — Teacher Test History for Streamed Exams

### 2.1 Endpoint: `GET /api/v1/tests/{test_id}/exam-sessions`

**File:** `backend/app/api/v1/endpoints/tests.py`

- Teachers can view all exam sessions for their tests
- Returns list of `ExamSession` records with:
  - Student name/username
  - Questions generated (with full text, options, correct answers)
  - Student's answers and score
  - Timestamp, duration
- Supports pagination and filtering (by student, date range, score range)

### 2.2 Schema: `ExamSessionResponse`

```python
class ExamSessionResponse(BaseModel):
    id: str
    student_name: str
    student_username: str
    test_title: str
    subject_name: str
    questions: list[ExamSessionQuestionDetail]
    score: int | None
    total_marks: int | None
    percentage: float | None
    status: str
    started_at: datetime
    completed_at: datetime | None

class ExamSessionQuestionDetail(BaseModel):
    question_id: str
    question_text: str
    options: list[str] | None
    correct_answer: str
    student_answer: str | None
    is_correct: bool | None
    difficulty_level: str | None
    marks: int
```

---

## Part 3: Client — SSE-Based Exam Flow

### 3.1 New Service: Streaming Exam Client

**File:** `client/services/tests.ts` (extend existing)

```typescript
// New types
interface ExamStartedEvent {
  exam_session_id: string;
  test_title: string;
  subject_name: string;
  total_questions: number;
  duration_minutes: number | null;
}

interface ExamQuestionEvent {
  index: number;
  question_id: string;
  question_text: string;
  question_type: string;
  options: string[] | null;
  difficulty_level: string | null;
  marks: number;
  total_questions: number;
}

// New method
startStreamingExam(
  testId: string,
  onExamStarted: (data: ExamStartedEvent) => void,
  onQuestionReady: (data: ExamQuestionEvent) => void,
  onComplete: () => void,
  onError: (error: string) => void,
): EventSource

submitStreamingExam(
  examSessionId: string,
  answers: { question_id: string; selected_answer: string }[],
  totalTimeSeconds: number,
): Promise<ExamResult>
```

### 3.2 Redesigned Take-Test Screen with Streaming

**File:** `client/app/(tabs)/tests/take-test.tsx` (major rewrite)

**New Flow:**
1. **Loading Phase** — "Preparing your exam..." with animated owl/mascot
2. **SSE connects** → receives `exam_started` → shows countdown (3...2...1...GO!)
3. **First question arrives** → animated reveal with slide-in + scale spring
4. **Student answers** → while they're answering, next question is already being generated server-side
5. **Transition to next question** → smooth card swap animation (slide out left, new slides in right)
6. **If next question isn't ready yet** → brief "Generating next question..." loading with pulse animation (should be rare if LLM is fast)
7. **After last question** → celebration animation → result screen with score, XP, level-up effects

**State Machine:**
```
LOADING → COUNTDOWN → ANSWERING → TRANSITIONING → ANSWERING → ... → SUBMITTING → RESULTS
```

---

## Part 4: Client — Duolingo-Style Animations & Transitions

### 4.1 Lesson Path Screen (Learn Tab — Duolingo Home Clone)

**File:** `client/app/(tabs)/learn/index.tsx` (major redesign)

Redesign the Learn dashboard to look like Duolingo's home screen with a **vertical scrolling lesson path**:

- **Path Nodes**: Circular star buttons arranged in a sinusoidal/zigzag path down the screen
  - Green filled star = completed lesson
  - Large green star with ring = current lesson (pulsing glow animation)
  - Gray locked star = future/locked lessons  
  - Special nodes: treasure chest (bonus), owl character (checkpoint)
- **Current Unit Banner**: Green card at top showing "SECTION X, UNIT Y" with subject name
- **Background**: Dark gradient with path line connecting all nodes
- **Animations**:
  - Path nodes scale-in with stagger (50ms delay between each)
  - Current node has continuous pulse animation (scale 1.0 → 1.05 → 1.0, loop)
  - Completed nodes have a subtle shine/sparkle effect
  - Scroll-linked parallax on background elements
- **On Node Tap**: 
  - Active node → expand tooltip showing lesson name + "START +XX XP" button
  - Completed node → show score/stars earned
  - Locked node → shake animation + lock icon
- **Floating Elements**: Small decorative clouds/shapes that parallax-scroll

**Implementation Notes:**
- Use `react-native-reanimated` `useSharedValue` + `useAnimatedStyle` for all animations
- Path layout calculated mathematically: `x = centerX + sin(index * 0.8) * amplitude`
- `FlatList` with `onScroll` event for parallax
- Each node is a `Pressable` wrapped in `ReAnimated.View`

### 4.2 Lesson Start Splash Animation

**File:** `client/app/(tabs)/learn/lesson.tsx` (enhance existing)

When starting a lesson, show a brief Duolingo-style splash:
- Full-screen gradient (blue sky + clouds)
- Mascot character (owl emoji or custom SVG) bouncing in from top
- Subject/topic text fades in
- Auto-transitions to first question after 1.5s
- Uses `withSpring` for bouncy entrance, `withTiming` for fade

### 4.3 Question Transitions

**File:** `client/app/(tabs)/tests/take-test.tsx` + `learn/lesson.tsx`

Enhanced question-to-question transitions:
- **Correct answer**: Green flash → confetti particles → card slides out left with spring
- **Wrong answer**: Red shake → gentle vibration → card slides out with damping
- **Next question**: New card slides in from right with `withSpring({ damping: 15, stiffness: 150 })`
- **Options appear**: Staggered fade-in (each option 70ms apart) from bottom
- **Progress bar**: Smooth animated width change with `withTiming({ duration: 300 })`

### 4.4 Streak Celebration Screen

**File:** `client/components/gamification/streak-celebration.tsx` (new)

After completing a lesson/exam, show a streak celebration overlay:
- Large streak number with fire emoji
- Motivational message ("I knew you'd come back! Let's do this")
- Animated mascot character
- Flame/fire particle effects around the number
- Auto-dismiss after 3s or on tap
- `withSequence` for entrance: scale from 0 → 1.2 → 1.0

### 4.5 Reward Chest Animation

**File:** `client/components/gamification/reward-chest.tsx` (new)

After certain milestones (every 5 lessons, perfect scores):
- Treasure chest appears center screen
- "COMMON" / "RARE" / "EPIC" tier label based on performance
- Three upgrade arrows below (tap to "open")
- Chest bounces/shakes on tap
- Opens to reveal XP bonus, streak freeze, or other reward
- Sparkle particle effects on open

### 4.6 XP Level-Up Animation

**File:** `client/components/gamification/level-up.tsx` (new)

When student crosses XP threshold for a new level:
- Full-screen dark overlay
- Level number scales up from center
- "Level X!" text with golden glow effect
- Star burst particle animation
- Sound effect trigger (optional via expo-av)
- Auto-dismiss after 2.5s

---

## Part 5: Database Migration

### 5.1 Alembic Migration: `009_add_exam_sessions.py`

**File:** `backend/alembic/versions/009_add_exam_sessions.py`

```sql
CREATE TABLE exam_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID NOT NULL REFERENCES tests(id),
    student_id UUID NOT NULL REFERENCES users(id),
    subject_id UUID NOT NULL REFERENCES subjects(id),
    status VARCHAR(20) DEFAULT 'in_progress',
    total_questions_planned INTEGER DEFAULT 10,
    total_questions_generated INTEGER DEFAULT 0,
    question_ids JSON DEFAULT '[]',
    answers JSON,
    score INTEGER,
    total_marks INTEGER,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_exam_sessions_test_id ON exam_sessions(test_id);
CREATE INDEX idx_exam_sessions_student_id ON exam_sessions(student_id);
CREATE INDEX idx_exam_sessions_status ON exam_sessions(status);
```

### 5.2 Set Default Vetting Status

Either:
- **Option A**: ALTER TABLE questions ALTER COLUMN vetting_status SET DEFAULT 'approved' (schema-level)
- **Option B**: Change in Python service code only (application-level) — **preferred**, less migration risk

---

## Part 6: Implementation Order

### Phase 1 — Backend Streaming Exam (Priority: Critical)
1. Add `ExamSession` model + migration
2. Create `stream_exam_questions()` in `TestService`
3. Modify question generation to auto-approve (`vetting_status='approved'`)
4. Add `POST /tests/student/{test_id}/stream-exam` SSE endpoint
5. Add `POST /tests/student/stream-exam/submit` submission endpoint
6. Add `GET /tests/{test_id}/exam-sessions` teacher history endpoint

### Phase 2 — Client Streaming Exam (Priority: Critical)
7. Add SSE streaming types + service methods in `client/services/tests.ts`
8. Rewrite `take-test.tsx` with SSE-connected question flow
9. Add exam result submission flow
10. Test end-to-end with real LLM generation

### Phase 3 — Duolingo Animations (Priority: High)
11. Redesign Learn dashboard with vertical lesson path + star nodes
12. Add lesson start splash animation
13. Enhance question-to-question transitions (both lesson + test screens)
14. Add streak celebration component
15. Add reward chest animation component
16. Add XP level-up animation component

### Phase 4 — Teacher History (Priority: Medium)
17. Add exam sessions list to teacher test detail view
18. Show generated questions + student answers per session
19. Add filtering/search for exam sessions

---

## Files to Create/Modify

### New Files
| File | Description |
|------|-------------|
| `backend/alembic/versions/009_add_exam_sessions.py` | Migration for exam_sessions table |
| `client/components/gamification/streak-celebration.tsx` | Streak celebration overlay |
| `client/components/gamification/reward-chest.tsx` | Reward chest animation |
| `client/components/gamification/level-up.tsx` | Level-up celebration animation |

### Modified Files
| File | Changes |
|------|---------|
| `backend/app/models/test.py` | Add `ExamSession` model |
| `backend/app/schemas/test.py` | Add exam stream event schemas, exam session response schemas |
| `backend/app/services/test_service.py` | Add `stream_exam_questions()`, `submit_stream_exam()`, `get_exam_sessions()` |
| `backend/app/services/question_service.py` | Auto-approve generated questions (set `vetting_status='approved'`) |
| `backend/app/api/v1/endpoints/tests.py` | Add streaming exam endpoint, exam submit, exam sessions list |
| `client/services/tests.ts` | Add SSE streaming exam types + methods |
| `client/app/(tabs)/tests/take-test.tsx` | Major rewrite: SSE-connected question flow with animations |
| `client/app/(tabs)/tests/index.tsx` | Update student test cards to launch streaming exam |
| `client/app/(tabs)/learn/index.tsx` | Redesign as Duolingo lesson path with star nodes |
| `client/app/(tabs)/learn/lesson.tsx` | Add splash animation, enhanced transitions |
| `client/app/(tabs)/learn/result.tsx` | Trigger streak celebration, reward chest, level-up animations |
| `client/stores/learningStore.ts` | Add streaming exam state management |
| `client/constants/theme.ts` | Add animation constants (spring configs, durations) |

---

## Technical Constraints & Notes

1. **LLM Latency**: First question should be ready in 2-5 seconds. Use a streamlined single-question prompt (not batch) to minimize time-to-first-question. Consider caching document chunks per subject.
2. **SSE Reliability**: Handle reconnection gracefully — if SSE drops, client can poll for remaining questions via REST fallback.
3. **Concurrency**: Multiple students may start exams simultaneously. Each gets independent generation (no shared question pool for streaming exams).
4. **Question Quality**: Even though auto-approved, still run novelty validation to avoid duplicates within the same exam session.
5. **Backward Compatibility**: Existing pre-made tests (teacher-generated) still work via the old flow. Streaming exam is a new parallel path.
6. **Animation Performance**: All animations use `react-native-reanimated` native driver (runs on UI thread, not JS thread). Target 120fps on ProMotion displays.
7. **Memory**: Question objects are lightweight (~1KB each). Even 50 questions in memory is fine.
8. **Hearts**: Streaming exams don't consume hearts (that's for practice lessons only). Tests have their own scoring.
