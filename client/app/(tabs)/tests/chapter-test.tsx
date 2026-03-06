/**
 * Streaming Chapter Test Screen - AI generates questions in real-time via SSE
 * First question appears instantly, subsequent questions generated while answering.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  withSequence,
  withRepeat,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import learnService, { ChapterQuestionEvent, ChapterTestResult } from '@/services/learn';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SPRING_SNAPPY = { damping: 20, stiffness: 200, mass: 0.8 };
const SPRING_BOUNCY = { damping: 12, stiffness: 150, mass: 0.6 };
const SPRING_GENTLE = { damping: 15, stiffness: 100, mass: 1 };

export default function ChapterTestScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { subjectId, subjectName, topicId, topicName } = useLocalSearchParams<{
    subjectId: string;
    subjectName?: string;
    topicId: string;
    topicName?: string;
  }>();

  // SSE streaming state
  const [examSessionId, setExamSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ChapterQuestionEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationComplete, setGenerationComplete] = useState(false);
  const [totalPlanned, setTotalPlanned] = useState(5);
  const [waitingForNextQuestion, setWaitingForNextQuestion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sseRef = useRef<any>(null);

  // Test state
  const [showCountdown, setShowCountdown] = useState(false);
  const [countdownValue, setCountdownValue] = useState('3');
  const [testStarted, setTestStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [testResult, setTestResult] = useState<ChapterTestResult | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Animation values
  const countdownScale = useSharedValue(0);
  const countdownOpacity = useSharedValue(0);
  const overlayOpacity = useSharedValue(1);
  const questionFade = useSharedValue(1);
  const questionScale = useSharedValue(1);
  const resultScale = useSharedValue(0);
  const resultOpacity = useSharedValue(0);

  // Option animation values
  const opt0Opacity = useSharedValue(0); const opt0TranslateY = useSharedValue(30);
  const opt1Opacity = useSharedValue(0); const opt1TranslateY = useSharedValue(30);
  const opt2Opacity = useSharedValue(0); const opt2TranslateY = useSharedValue(30);
  const opt3Opacity = useSharedValue(0); const opt3TranslateY = useSharedValue(30);
  const optionValues = [
    { opacity: opt0Opacity, translateY: opt0TranslateY },
    { opacity: opt1Opacity, translateY: opt1TranslateY },
    { opacity: opt2Opacity, translateY: opt2TranslateY },
    { opacity: opt3Opacity, translateY: opt3TranslateY },
  ];

  // Pre-create animated styles for each option (hooks must be called at top level)
  const opt0AnimStyle = useAnimatedStyle(() => ({
    opacity: opt0Opacity.value,
    transform: [{ translateY: opt0TranslateY.value }],
  }));
  const opt1AnimStyle = useAnimatedStyle(() => ({
    opacity: opt1Opacity.value,
    transform: [{ translateY: opt1TranslateY.value }],
  }));
  const opt2AnimStyle = useAnimatedStyle(() => ({
    opacity: opt2Opacity.value,
    transform: [{ translateY: opt2TranslateY.value }],
  }));
  const opt3AnimStyle = useAnimatedStyle(() => ({
    opacity: opt3Opacity.value,
    transform: [{ translateY: opt3TranslateY.value }],
  }));
  const optionAnimStyles = [opt0AnimStyle, opt1AnimStyle, opt2AnimStyle, opt3AnimStyle];

  // Timer
  useEffect(() => {
    if (!testStarted || testResult) return;
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [testStarted, testResult]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Countdown animation
  const startCountdown = useCallback(() => {
    setShowCountdown(true);
    const steps = ['3', '2', '1', 'GO!'];
    let i = 0;

    const showNext = () => {
      if (i >= steps.length) {
        overlayOpacity.value = withTiming(0, { duration: 300 }, () => {
          runOnJS(setShowCountdown)(false);
          runOnJS(setTestStarted)(true);
        });
        return;
      }
      runOnJS(setCountdownValue)(steps[i]);
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Heavy);

      countdownScale.value = 0;
      countdownOpacity.value = 1;
      countdownScale.value = withSequence(
        withSpring(1.3, { damping: 8, stiffness: 300 }),
        withSpring(1, { damping: 14, stiffness: 200 })
      );

      setTimeout(() => {
        countdownOpacity.value = withTiming(0, { duration: 250 });
        i++;
        setTimeout(showNext, 300);
      }, 600);
    };

    setTimeout(showNext, 200);
  }, []);

  // Animate options in
  const animateOptionsIn = useCallback(() => {
    optionValues.forEach((opt, idx) => {
      opt.opacity.value = 0;
      opt.translateY.value = 30;
      opt.opacity.value = withDelay(idx * 80, withTiming(1, { duration: 300 }));
      opt.translateY.value = withDelay(idx * 80, withSpring(0, SPRING_GENTLE));
    });
  }, []);

  // Load test via SSE streaming
  useEffect(() => {
    if (!subjectId || !topicId) return;

    setIsLoading(true);
    setIsGenerating(true);
    setGenerationComplete(false);
    setError(null);

    const eventSource = learnService.startStreamingChapterTest(subjectId, topicId, 5, {
      onExamStarted: (event) => {
        setExamSessionId(event.exam_session_id);
        setTotalPlanned(event.total_questions);
      },
      onQuestionReady: (event) => {
        setQuestions((prev) => {
          if (prev.some((q) => q.question_id === event.question_id)) {
            return prev;
          }
          const updated = [...prev, event];

          // First question arrived - start countdown
          if (updated.length === 1) {
            runOnJS(setIsLoading)(false);
            setTimeout(() => runOnJS(startCountdown)(), 300);
          }

          // Clear waiting state
          runOnJS(setWaitingForNextQuestion)(false);
          return updated;
        });
      },
      onComplete: (totalGenerated) => {
        setIsGenerating(false);
        setGenerationComplete(true);
      },
      onError: (message) => {
        setError(message);
        setIsLoading(false);
        setIsGenerating(false);
      },
    });

    sseRef.current = eventSource;

    return () => {
      eventSource?.close();
    };
  }, [subjectId, topicId, startCountdown]);

  // Animate on question change
  useEffect(() => {
    if (testStarted && questions.length > 0) {
      questionFade.value = 1;
      questionScale.value = 1;
      animateOptionsIn();
    }
  }, [currentIndex, testStarted, questions.length]);

  const currentQuestion = questions[currentIndex];
  const progress = totalPlanned > 0 ? (currentIndex + 1) / totalPlanned : 0;
  const hasNextQuestion = currentIndex < questions.length - 1 || !generationComplete;

  const handleSelectAnswer = (answer: string) => {
    if (showResult) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedAnswer(answer);
  };

  const handleCheckAnswer = () => {
    if (!selectedAnswer || !currentQuestion) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const answerLetter = selectedAnswer.charAt(0).toUpperCase();
    setAnswers((prev) => ({
      ...prev,
      [currentQuestion.question_id]: answerLetter,
    }));
    setShowResult(true);
  };

  const handleNext = useCallback(async () => {
    if (currentIndex < questions.length - 1) {
      // Next question already available
      questionFade.value = withTiming(0, { duration: 200 }, () => {
        runOnJS(setCurrentIndex)(currentIndex + 1);
        runOnJS(setSelectedAnswer)(null);
        runOnJS(setShowResult)(false);
      });
    } else if (!generationComplete) {
      // Wait for next question
      setWaitingForNextQuestion(true);
      // Question will arrive via SSE, which will clear waiting state
    } else {
      // All questions answered - submit
      setSubmitting(true);
      try {
        const answerArray = Object.entries(answers).map(([q_id, selected]) => ({
          question_id: q_id,
          selected_answer: selected,
        }));

        const result = await learnService.submitChapterTest(
          examSessionId!,
          answerArray,
          elapsedSeconds
        );
        setTestResult(result);

        // Animate result in
        resultScale.value = withSpring(1, SPRING_BOUNCY);
        resultOpacity.value = withTiming(1, { duration: 400 });
        Haptics.notificationAsync(
          result.accuracy >= 60
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning
        );
      } catch (e: any) {
        setError(e?.message || 'Failed to submit test');
      } finally {
        setSubmitting(false);
      }
    }
  }, [currentIndex, questions.length, generationComplete, answers, examSessionId, elapsedSeconds]);

  // When next question arrives while waiting
  useEffect(() => {
    if (waitingForNextQuestion && currentIndex < questions.length - 1) {
      questionFade.value = withTiming(0, { duration: 200 }, () => {
        runOnJS(setCurrentIndex)(currentIndex + 1);
        runOnJS(setSelectedAnswer)(null);
        runOnJS(setShowResult)(false);
        runOnJS(setWaitingForNextQuestion)(false);
      });
    }
  }, [questions.length, waitingForNextQuestion, currentIndex]);

  const handleQuit = () => {
    sseRef.current?.close();
    router.back();
  };

  const countdownAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: countdownScale.value }],
    opacity: countdownOpacity.value,
  }));

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const questionAnimatedStyle = useAnimatedStyle(() => ({
    opacity: questionFade.value,
    transform: [{ scale: questionScale.value }],
  }));

  const resultAnimatedStyle = useAnimatedStyle(() => ({
    opacity: resultOpacity.value,
    transform: [{ scale: resultScale.value }],
  }));

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Generating questions with AI...
          </Text>
          <Text style={[styles.loadingSubtext, { color: colors.textTertiary }]}>
            First question will appear instantly
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={[styles.errorTitle, { color: colors.text }]}>
            {error}
          </Text>
          <TouchableOpacity
            style={[styles.quitButton, { backgroundColor: colors.primary }]}
            onPress={handleQuit}
          >
            <Text style={styles.quitButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Result screen
  if (testResult) {
    const passedEmoji = testResult.accuracy >= 80 ? '🎉' : testResult.accuracy >= 60 ? '✅' : '💪';

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ReAnimated.View style={[styles.resultContainer, resultAnimatedStyle]}>
          <Text style={styles.resultEmoji}>{passedEmoji}</Text>
          <Text style={[styles.resultTitle, { color: colors.text }]}>
            {testResult.accuracy >= 80 ? 'Excellent!' : testResult.accuracy >= 60 ? 'Good Job!' : 'Keep Practicing!'}
          </Text>
          <Text style={[styles.resultSubtitle, { color: colors.textSecondary }]}>
            {topicName || 'Chapter Test'} Complete
          </Text>

          <View style={styles.statsGrid}>
            <View style={[styles.statBox, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {Math.round(testResult.accuracy)}%
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                Score
              </Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValue, { color: '#34C759' }]}>
                {testResult.correct_answers}/{testResult.total_questions}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                Correct
              </Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValue, { color: '#FF9500' }]}>
                +{testResult.xp_earned}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                XP Earned
              </Text>
            </View>
          </View>

          {testResult.tutor_feedback && (
            <View style={[styles.feedbackBox, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={styles.feedbackIcon}>🤖</Text>
              <Text style={[styles.feedbackText, { color: colors.text }]}>
                {testResult.tutor_feedback}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.doneButton, { backgroundColor: colors.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </ReAnimated.View>
      </SafeAreaView>
    );
  }

  // Countdown overlay
  if (showCountdown) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ReAnimated.View style={[styles.countdownOverlay, overlayAnimatedStyle]}>
          <ReAnimated.Text style={[styles.countdownText, { color: colors.primary }, countdownAnimatedStyle]}>
            {countdownValue}
          </ReAnimated.Text>
        </ReAnimated.View>
      </SafeAreaView>
    );
  }

  // Main test UI
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleQuit}>
          <Text style={[styles.closeButton, { color: colors.textSecondary }]}>✕</Text>
        </TouchableOpacity>
        <View style={[styles.progressBarBg, { backgroundColor: colors.glassTertiary }]}>
          <LinearGradient
            colors={['#007AFF', '#5856D6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.progressBarFill, { width: `${progress * 100}%` }]}
          />
        </View>
        <View style={styles.timerBox}>
          <Text style={[styles.timerText, { color: colors.textSecondary }]}>
            {formatTime(elapsedSeconds)}
          </Text>
        </View>
      </View>

      {/* Generation status */}
      {isGenerating && (
        <View style={styles.generatingStrip}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.generatingText, { color: colors.textSecondary }]}>
            Generating: {questions.length}/{totalPlanned}
          </Text>
        </View>
      )}

      {/* Question */}
      {currentQuestion ? (
        <ScrollView contentContainerStyle={styles.questionArea}>
          <ReAnimated.View style={[styles.questionCard, questionAnimatedStyle]}>
            <View style={styles.questionHeader}>
              <Text style={[styles.questionNumber, { color: colors.primary }]}>
                Question {currentIndex + 1}
              </Text>
              <View style={[styles.diffBadge, { backgroundColor: getDiffColor(currentQuestion.difficulty_level) + '20' }]}>
                <Text style={[styles.diffText, { color: getDiffColor(currentQuestion.difficulty_level) }]}>
                  {currentQuestion.difficulty_level || 'Adaptive'}
                </Text>
              </View>
            </View>
            <Text style={[styles.questionText, { color: colors.text }]}>
              {currentQuestion.question_text}
            </Text>

            {/* Options */}
            <View style={styles.optionsContainer}>
              {currentQuestion.options?.map((opt, idx) => {
                const letter = String.fromCharCode(65 + idx);
                const isSelected = selectedAnswer?.startsWith(letter);

                return (
                  <ReAnimated.View key={idx} style={optionAnimStyles[idx]}>
                    <TouchableOpacity
                      style={[
                        styles.optionButton,
                        {
                          backgroundColor: isSelected ? colors.primary + '15' : colors.backgroundSecondary,
                          borderColor: isSelected ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => handleSelectAnswer(`${letter}) ${opt}`)}
                      disabled={showResult}
                    >
                      <View style={[styles.optionLetter, { backgroundColor: isSelected ? colors.primary : colors.glassTertiary }]}>
                        <Text style={[styles.optionLetterText, { color: isSelected ? '#FFF' : colors.textSecondary }]}>
                          {letter}
                        </Text>
                      </View>
                      <Text style={[styles.optionText, { color: colors.text }]} numberOfLines={3}>
                        {opt}
                      </Text>
                    </TouchableOpacity>
                  </ReAnimated.View>
                );
              })}
            </View>
          </ReAnimated.View>
        </ScrollView>
      ) : (
        <View style={styles.waitingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.waitingText, { color: colors.textSecondary }]}>
            Generating next question...
          </Text>
        </View>
      )}

      {/* Bottom action */}
      <View style={styles.bottomBar}>
        {waitingForNextQuestion ? (
          <View style={[styles.waitingButton, { backgroundColor: colors.backgroundSecondary }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.waitingButtonText, { color: colors.textSecondary }]}>
              Preparing next question...
            </Text>
          </View>
        ) : showResult ? (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={handleNext}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.actionButtonText}>
                {hasNextQuestion ? 'Next Question' : 'See Results'}
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: selectedAnswer ? colors.primary : colors.glassTertiary },
            ]}
            onPress={handleCheckAnswer}
            disabled={!selectedAnswer}
          >
            <Text style={[styles.actionButtonText, { color: selectedAnswer ? '#FFF' : colors.textTertiary }]}>
              Check Answer
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

function getDiffColor(diff?: string | null) {
  if (diff === 'hard') return '#FF3B30';
  if (diff === 'medium') return '#FF9500';
  return '#34C759';
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { fontSize: 16, marginTop: 16 },
  loadingSubtext: { fontSize: 13, marginTop: 6 },
  errorEmoji: { fontSize: 48, marginBottom: 16 },
  errorTitle: { fontSize: 16, textAlign: 'center' },
  quitButton: { marginTop: 24, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 12 },
  quitButtonText: { color: '#FFF', fontWeight: '600', fontSize: 16 },

  countdownOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  countdownText: { fontSize: 120, fontWeight: '800' },

  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  closeButton: { fontSize: 22, fontWeight: '600' },
  progressBarBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 4 },
  timerBox: { width: 50, alignItems: 'center' },
  timerText: { fontSize: 14, fontWeight: '600' },

  generatingStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  generatingText: { fontSize: 13 },

  questionArea: { padding: 16, paddingBottom: 120 },
  questionCard: { padding: 20 },
  questionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  questionNumber: { fontSize: 14, fontWeight: '700' },
  diffBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  diffText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  questionText: { fontSize: 18, fontWeight: '600', lineHeight: 26 },

  optionsContainer: { marginTop: 24, gap: 12 },
  optionButton: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1.5, gap: 12 },
  optionLetter: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  optionLetterText: { fontSize: 14, fontWeight: '700' },
  optionText: { flex: 1, fontSize: 15, lineHeight: 21 },

  waitingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  waitingText: { fontSize: 15, marginTop: 16 },

  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 32 },
  actionButton: { paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  actionButtonText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  waitingButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14, gap: 10 },
  waitingButtonText: { fontSize: 15, fontWeight: '500' },

  // Result
  resultContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  resultEmoji: { fontSize: 64, marginBottom: 16 },
  resultTitle: { fontSize: 28, fontWeight: '800' },
  resultSubtitle: { fontSize: 16, marginTop: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 32 },
  statBox: { width: 100, padding: 16, borderRadius: 16, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12, marginTop: 4 },
  feedbackBox: { marginTop: 24, padding: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12, maxWidth: 340 },
  feedbackIcon: { fontSize: 20 },
  feedbackText: { flex: 1, fontSize: 14, lineHeight: 20 },
  doneButton: { marginTop: 32, paddingHorizontal: 48, paddingVertical: 16, borderRadius: 14 },
  doneButtonText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
});
