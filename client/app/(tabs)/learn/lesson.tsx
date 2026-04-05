/**
 * Gamified Lesson Screen - Duolingo-style quiz
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import { useLearningStore } from '@/stores/learningStore';
import { HeartsDisplay } from '@/components/gamification';
import type { AnswerSubmission } from '@/services/learn';

export default function LessonScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const params = useLocalSearchParams<{ subjectId: string; subjectName: string; topicId?: string }>();

  const { currentLesson, isLoading, error, startLesson, submitLesson } = useLearningStore();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [answers, setAnswers] = useState<AnswerSubmission[]>([]);
  const [hearts, setHearts] = useState(5);
  const [lessonStartTime, setLessonStartTime] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (params.subjectId) {
      startLesson(params.subjectId, params.topicId);
    }
  }, [params.subjectId, params.topicId, startLesson]);

  useEffect(() => {
    if (currentLesson) {
      setHearts(currentLesson.hearts_remaining);
      setLessonStartTime(Date.now());
    }
  }, [currentLesson]);

  const questions = currentLesson?.questions ?? [];
  const currentQuestion = questions[currentIndex];
  const progress = questions.length > 0 ? (currentIndex + 1) / questions.length : 0;

  const handleSelectAnswer = (answer: string) => {
    if (showResult) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedAnswer(answer);
  };

  const handleCheckAnswer = () => {
    if (!selectedAnswer || !currentQuestion) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Extract just the option letter (e.g. "A" from "A) Some answer text...")
    // The backend stores correct_answer as just the letter (A, B, C, D)
    const answerLetter = selectedAnswer.charAt(0).toUpperCase();

    setShowResult(true);

    setAnswers((prev) => [
      ...prev,
      {
        question_id: currentQuestion.id,
        selected_answer: answerLetter,
      },
    ]);
  };

  const handleNext = async () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    } else {
      setIsSubmitting(true);
      const totalTime = lessonStartTime ? Math.round((Date.now() - lessonStartTime) / 1000) : 0;
      await submitLesson(
        params.subjectId,
        params.topicId,
        answers,
        totalTime
      );
      router.replace({
        pathname: '/(tabs)/learn/result',
        params: { subjectId: params.subjectId, subjectName: params.subjectName },
      });
    }
  };

  const handleQuit = () => {
    router.back();
  };

  if (isLoading && !currentLesson) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading lesson...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !currentLesson || questions.length === 0) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <Text style={styles.emptyEmoji}>📭</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {error || 'No questions available for this subject yet.'}
          </Text>
          <TouchableOpacity onPress={handleQuit} style={[styles.quitButton, { backgroundColor: colors.primary }]}>
            <Text style={styles.quitButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
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
        <HeartsDisplay hearts={hearts} compact />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Question Counter */}
        <Text style={[styles.questionCounter, { color: colors.textSecondary }]}>
          Question {currentIndex + 1} of {questions.length}
        </Text>

        {/* Difficulty Badge */}
        {currentQuestion.difficulty_level && (
          <View
            style={[
              styles.difficultyBadge,
              {
                backgroundColor:
                  currentQuestion.difficulty_level === 'hard'
                    ? '#FF3B3020'
                    : currentQuestion.difficulty_level === 'medium'
                      ? '#FF950020'
                      : '#34C75920',
              },
            ]}
          >
            <Text
              style={[
                styles.difficultyText,
                {
                  color:
                    currentQuestion.difficulty_level === 'hard'
                      ? '#FF3B30'
                      : currentQuestion.difficulty_level === 'medium'
                        ? '#FF9500'
                        : '#34C759',
                },
              ]}
            >
              {currentQuestion.difficulty_level.charAt(0).toUpperCase() +
                currentQuestion.difficulty_level.slice(1)}
            </Text>
          </View>
        )}

        {/* Question Text */}
        <Text style={[styles.questionText, { color: colors.text }]}>
          {currentQuestion.question_text}
        </Text>

        {/* Options */}
        <View style={styles.optionsContainer}>
          {currentQuestion.options?.map((option, idx) => {
            const isSelected = selectedAnswer === option;
            let optionStyle = {};
            let textColor = colors.text;

            if (showResult && isSelected) {
              optionStyle = { backgroundColor: `${colors.primary}15`, borderColor: colors.primary };
              textColor = colors.primary;
            } else if (isSelected) {
              optionStyle = { backgroundColor: `${colors.primary}15`, borderColor: colors.primary };
              textColor = colors.primary;
            }

            return (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.optionButton,
                  { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
                  optionStyle,
                ]}
                onPress={() => handleSelectAnswer(option)}
                disabled={showResult}
                activeOpacity={0.7}
              >
                <View style={styles.optionContent}>
                  <View
                    style={[
                      styles.optionIndex,
                      {
                        backgroundColor: isSelected ? `${colors.primary}20` : colors.glassTertiary,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionIndexText,
                        { color: isSelected ? colors.primary : colors.textSecondary },
                      ]}
                    >
                      {String.fromCharCode(65 + idx)}
                    </Text>
                  </View>
                  <Text style={[styles.optionText, { color: textColor }]}>{option}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Result Feedback */}
        {showResult && (
          <View
            style={[
              styles.feedback,
              { backgroundColor: `${colors.primary}15` },
            ]}
          >
            <Text style={styles.feedbackEmoji}>✅</Text>
            <Text
              style={[styles.feedbackText, { color: colors.primary }]}
            >
              Answer recorded
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom Action */}
      <View style={[styles.bottomBar, { backgroundColor: colors.background, paddingBottom: 120 }]}>
        {!showResult ? (
          <TouchableOpacity
            style={[
              styles.actionButton,
              {
                backgroundColor: selectedAnswer ? colors.primary : colors.glassTertiary,
              },
            ]}
            onPress={handleCheckAnswer}
            disabled={!selectedAnswer}
          >
            <Text
              style={[
                styles.actionButtonText,
                { color: selectedAnswer ? '#fff' : colors.textSecondary },
              ]}
            >
              Check
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={handleNext}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionButtonText}>
                {currentIndex < questions.length - 1 ? 'Continue' : 'Finish'}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  loadingText: { marginTop: Spacing.md, fontSize: FontSizes.md },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSizes.md, textAlign: 'center', marginTop: Spacing.md },
  quitButton: { marginTop: Spacing.lg, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  quitButtonText: { color: '#fff', fontWeight: '600' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  closeButton: { fontSize: 22, fontWeight: '600' },
  progressBarBg: { flex: 1, height: 10, borderRadius: 5, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 5 },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.lg, paddingBottom: 120 },
  questionCounter: { fontSize: FontSizes.sm, marginBottom: Spacing.xs },
  difficultyBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
  },
  difficultyText: { fontSize: FontSizes.xs, fontWeight: '600' },
  questionText: { fontSize: FontSizes.xl, fontWeight: '600', lineHeight: 28, marginBottom: Spacing.xl },
  optionsContainer: { gap: Spacing.sm },
  optionButton: {
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    overflow: 'hidden',
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.md,
  },
  optionIndex: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionIndexText: { fontSize: FontSizes.sm, fontWeight: '700' },
  optionText: { flex: 1, fontSize: FontSizes.md },
  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  feedbackEmoji: { fontSize: 24 },
  feedbackText: { fontSize: FontSizes.md, fontWeight: '600' },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    paddingBottom: 40,
  },
  actionButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
  },
  actionButtonText: { fontSize: FontSizes.lg, fontWeight: '700', color: '#fff' },
});
