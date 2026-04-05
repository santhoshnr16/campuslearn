/**
 * Lesson Result Screen - shows score, XP earned, streak, and AI Tutor feedback
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Animated, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import { useLearningStore } from '@/stores/learningStore';

export default function ResultScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const params = useLocalSearchParams<{ subjectId: string; subjectName: string }>();

  const { lessonResult, clearLesson, loadProfile } = useLearningStore();

  // Animations
  const heroScale = useRef(new Animated.Value(0)).current;
  const feedbackFade = useRef(new Animated.Value(0)).current;
  const feedbackSlide = useRef(new Animated.Value(20)).current;
  const confettiOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Animate hero entrance
    Animated.spring(heroScale, {
      toValue: 1,
      tension: 40,
      friction: 5,
      useNativeDriver: true,
    }).start();

    // Animate tutor feedback
    if (lessonResult?.tutor_feedback) {
      Animated.parallel([
        Animated.timing(feedbackFade, { toValue: 1, duration: 600, delay: 800, useNativeDriver: true }),
        Animated.timing(feedbackSlide, { toValue: 0, duration: 600, delay: 800, useNativeDriver: true }),
      ]).start();
    }

    // Celebration haptic for good scores
    if (lessonResult) {
      const accuracy = lessonResult.accuracy;
      if (accuracy >= 80) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (accuracy >= 50) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      if (lessonResult.level_up) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Flash confetti
        Animated.sequence([
          Animated.timing(confettiOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(confettiOpacity, { toValue: 0, duration: 2000, delay: 1500, useNativeDriver: true }),
        ]).start();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonResult]);

  const handleContinue = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    loadProfile();
    clearLesson();
    router.replace('/(tabs)/learn');
  };

  const handleRetry = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearLesson();
    router.replace({
      pathname: '/(tabs)/learn/lesson',
      params: { subjectId: params.subjectId, subjectName: params.subjectName },
    });
  };

  if (!lessonResult) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <Text style={[{ color: colors.text }]}>No results available.</Text>
          <TouchableOpacity onPress={handleContinue}>
            <Text style={[{ color: colors.primary, marginTop: 20 }]}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const accuracy = lessonResult.accuracy;
  const isPerfect = lessonResult.correct_answers === lessonResult.total_questions;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Confetti overlay for level-ups */}
        {lessonResult.level_up && (
          <Animated.View style={[styles.confettiOverlay, { opacity: confettiOpacity }]} pointerEvents="none">
            <Text style={styles.confettiText}>🎉🎊✨🎉🎊✨🎉</Text>
          </Animated.View>
        )}

        {/* Hero */}
        <Animated.View style={[styles.hero, { transform: [{ scale: heroScale }] }]}>
          <Text style={styles.heroEmoji}>
            {isPerfect ? '🏆' : accuracy >= 80 ? '🌟' : accuracy >= 50 ? '👍' : '💪'}
          </Text>
          <Text style={[styles.heroTitle, { color: colors.text }]}>
            {isPerfect ? 'Perfect!' : accuracy >= 80 ? 'Great Job!' : accuracy >= 50 ? 'Good Try!' : 'Keep Going!'}
          </Text>
          <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>
            {params.subjectName}
          </Text>
        </Animated.View>

        {/* Score */}
        <View style={[styles.scoreCard, { backgroundColor: colors.backgroundSecondary }]}>
          <View style={styles.scoreRow}>
            <Text style={[styles.scoreLabel, { color: colors.textSecondary }]}>Score</Text>
            <Text style={[styles.scoreValue, { color: colors.text }]}>
              {lessonResult.correct_answers}/{lessonResult.total_questions}
            </Text>
          </View>
          <View style={styles.scoreRow}>
            <Text style={[styles.scoreLabel, { color: colors.textSecondary }]}>Accuracy</Text>
            <Text style={[styles.scoreValue, { color: colors.text }]}>
              {Math.round(accuracy)}%
            </Text>
          </View>
        </View>

        {/* XP Earned */}
        <LinearGradient
          colors={['#007AFF', '#5856D6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.xpCard}
        >
          <Text style={styles.xpEmoji}>⚡</Text>
          <Text style={styles.xpText}>+{lessonResult.xp_earned} XP</Text>
          {lessonResult.level_up && (
            <Text style={styles.levelUpText}>🎉 Level Up! → Level {lessonResult.new_level}</Text>
          )}
        </LinearGradient>

        {/* Streak & Stats */}
        <View style={styles.statsGrid}>
          <View style={[styles.miniStat, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={styles.miniStatEmoji}>🔥</Text>
            <Text style={[styles.miniStatValue, { color: '#FF9500' }]}>
              {lessonResult.new_streak_count}
            </Text>
            <Text style={[styles.miniStatLabel, { color: colors.textSecondary }]}>Streak</Text>
          </View>
          <View style={[styles.miniStat, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={styles.miniStatEmoji}>❤️</Text>
            <Text style={[styles.miniStatValue, { color: '#FF3B30' }]}>
              {lessonResult.hearts_remaining}
            </Text>
            <Text style={[styles.miniStatLabel, { color: colors.textSecondary }]}>Hearts</Text>
          </View>
          <View style={[styles.miniStat, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={styles.miniStatEmoji}>📈</Text>
            <Text style={[styles.miniStatValue, { color: '#34C759' }]}>
              {Math.round(lessonResult.new_mastery)}%
            </Text>
            <Text style={[styles.miniStatLabel, { color: colors.textSecondary }]}>Mastery</Text>
          </View>
        </View>

        {/* AI Tutor Feedback */}
        {lessonResult.tutor_feedback ? (
          <Animated.View style={[
            styles.tutorCard,
            { backgroundColor: colors.backgroundSecondary, borderColor: colors.border, opacity: feedbackFade, transform: [{ translateY: feedbackSlide }] },
          ]}>
            <View style={styles.tutorHeader}>
              <View style={[styles.tutorAvatar, { backgroundColor: colors.primary + '20' }]}>
                <Text style={styles.tutorAvatarEmoji}>🤖</Text>
              </View>
              <View>
                <Text style={[styles.tutorName, { color: colors.text }]}>AI Tutor</Text>
                <Text style={[styles.tutorSubtitle, { color: colors.textTertiary }]}>Personalized feedback</Text>
              </View>
            </View>
            <View style={[styles.tutorBubble, { backgroundColor: colors.primary + '10' }]}>
              <Text style={[styles.tutorFeedbackText, { color: colors.text }]}>
                {lessonResult.tutor_feedback}
              </Text>
            </View>
          </Animated.View>
        ) : (
          <View style={[styles.tutorLoadingCard, { backgroundColor: colors.backgroundSecondary }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.tutorLoadingText, { color: colors.textSecondary }]}>
              The Tutor is evaluating your answers...
            </Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryAction, { backgroundColor: colors.primary }]}
            onPress={handleContinue}
          >
            <Text style={styles.primaryActionText}>Continue</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryAction, { borderColor: colors.primary }]}
            onPress={handleRetry}
          >
            <Text style={[styles.secondaryActionText, { color: colors.primary }]}>
              Try Again
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: Spacing.lg, paddingBottom: 100 },
  confettiOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  confettiText: { fontSize: 40, letterSpacing: 8 },
  hero: { alignItems: 'center', paddingVertical: Spacing.xl },
  heroEmoji: { fontSize: 64 },
  heroTitle: { fontSize: FontSizes.xxxl, fontWeight: '800', marginTop: Spacing.md },
  heroSubtitle: { fontSize: FontSizes.md, marginTop: Spacing.xs },
  scoreCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.lg,
    gap: Spacing.md,
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreLabel: { fontSize: FontSizes.md },
  scoreValue: { fontSize: FontSizes.xl, fontWeight: '700' },
  xpCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.md,
    alignItems: 'center',
  },
  xpEmoji: { fontSize: 32 },
  xpText: { fontSize: FontSizes.xxl, fontWeight: '800', color: '#fff', marginTop: Spacing.xs },
  levelUpText: { fontSize: FontSizes.md, color: '#fff', marginTop: Spacing.xs },
  statsGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  miniStat: {
    flex: 1,
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  miniStatEmoji: { fontSize: 24 },
  miniStatValue: { fontSize: FontSizes.xl, fontWeight: '700', marginTop: 4 },
  miniStatLabel: { fontSize: FontSizes.xs, marginTop: 2 },
  // AI Tutor styles
  tutorCard: {
    marginTop: Spacing.lg,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
  },
  tutorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  tutorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tutorAvatarEmoji: { fontSize: 22 },
  tutorName: { fontSize: FontSizes.md, fontWeight: '700' },
  tutorSubtitle: { fontSize: FontSizes.xs },
  tutorBubble: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  tutorFeedbackText: {
    fontSize: FontSizes.sm + 1,
    lineHeight: 22,
  },
  tutorLoadingCard: {
    marginTop: Spacing.lg,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  tutorLoadingText: { fontSize: FontSizes.sm },
  actions: { marginTop: Spacing.xl, gap: Spacing.sm },
  primaryAction: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
  },
  primaryActionText: { color: '#fff', fontSize: FontSizes.lg, fontWeight: '700' },
  secondaryAction: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    borderWidth: 2,
  },
  secondaryActionText: { fontSize: FontSizes.lg, fontWeight: '700' },
});
