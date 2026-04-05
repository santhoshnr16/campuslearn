/**
 * Student Learn Dashboard - shows enrolled subjects, XP, streaks
 */
import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import { useLearningStore } from '@/stores/learningStore';
import { useAuthStore } from '@/stores/authStore';
import { XPBar, StreakCounter, HeartsDisplay } from '@/components/gamification';
import type { SubjectStudent } from '@/services/learn';

export default function LearnDashboard() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const { user } = useAuthStore();
  const {
    profile,
    subjects,
    isLoading,
    error,
    loadProfile,
    loadSubjects,
    enrollInSubject,
    clearError,
  } = useLearningStore();

  const loadData = useCallback(async () => {
    await Promise.all([loadProfile(), loadSubjects()]);
  }, [loadProfile, loadSubjects]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleSubjectPress = async (subject: SubjectStudent) => {
    if (!subject.is_enrolled) {
      const success = await enrollInSubject(subject.id);
      if (!success) return;
    }
    router.push({
      pathname: '/(tabs)/learn/subject-detail',
      params: { subjectId: subject.id, subjectName: subject.name },
    });
  };

  const handleStartLesson = (subject: SubjectStudent) => {
    router.push({
      pathname: '/(tabs)/learn/lesson',
      params: { subjectId: subject.id, subjectName: subject.name },
    });
  };

  const enrolledSubjects = subjects.filter((s) => s.is_enrolled);
  const availableSubjects = subjects.filter((s) => !s.is_enrolled);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.greeting, { color: colors.text }]}>
            Hey, {user?.full_name || user?.username || 'Student'} 👋
          </Text>
          <View style={styles.headerStats}>
            <StreakCounter streak={profile?.streak_count ?? 0} compact />
            <HeartsDisplay hearts={profile?.hearts ?? 5} compact />
          </View>
        </View>

        {/* XP Bar */}
        {profile && (
          <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <XPBar
              xpTotal={profile.xp_total}
              level={profile.current_level}
            />
          </View>
        )}

        {/* Quick Stats */}
        {profile && (
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={styles.statEmoji}>📚</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {profile.subjects_enrolled}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Subjects</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={styles.statEmoji}>✅</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {profile.total_lessons_completed}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Lessons</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={styles.statEmoji}>🎯</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {Math.round(profile.overall_accuracy)}%
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Accuracy</Text>
            </View>
          </View>
        )}

        {/* Error */}
        {error && (
          <TouchableOpacity onPress={clearError}>
            <View style={[styles.errorCard, { backgroundColor: '#FF3B3020' }]}>
              <Text style={{ color: '#FF3B30' }}>{error}</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* My Subjects */}
        {enrolledSubjects.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>My Subjects</Text>
            {enrolledSubjects.map((subject) => (
              <TouchableOpacity
                key={subject.id}
                style={[styles.subjectCard, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleSubjectPress(subject)}
                activeOpacity={0.7}
              >
                <View style={styles.subjectInfo}>
                  <Text style={[styles.subjectCode, { color: colors.primary }]}>
                    {subject.code}
                  </Text>
                  <Text style={[styles.subjectName, { color: colors.text }]} numberOfLines={1}>
                    {subject.name}
                  </Text>
                  <View style={styles.subjectMeta}>
                    <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                      {subject.total_topics} topics · {Math.round(subject.mastery)}% mastery
                    </Text>
                  </View>
                  {/* Progress bar */}
                  <View style={[styles.progressBg, { backgroundColor: colors.glassTertiary }]}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.min(subject.mastery, 100)}%`,
                          backgroundColor: subject.mastery >= 80 ? '#34C759' : subject.mastery >= 50 ? '#FF9500' : '#007AFF',
                        },
                      ]}
                    />
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.startButton, { backgroundColor: colors.primary }]}
                  onPress={() => handleSubjectPress(subject)}
                >
                  <Text style={styles.startButtonText}>Learn</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Available Subjects */}
        {availableSubjects.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Available Subjects
            </Text>
            {availableSubjects.map((subject) => (
              <TouchableOpacity
                key={subject.id}
                style={[styles.subjectCard, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleSubjectPress(subject)}
                activeOpacity={0.7}
              >
                <View style={styles.subjectInfo}>
                  <Text style={[styles.subjectCode, { color: colors.primary }]}>
                    {subject.code}
                  </Text>
                  <Text style={[styles.subjectName, { color: colors.text }]} numberOfLines={1}>
                    {subject.name}
                  </Text>
                  <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                    by {subject.teacher_name} · {subject.total_topics} topics
                  </Text>
                </View>
                <View style={[styles.enrollButton, { borderColor: colors.primary }]}>
                  <Text style={[styles.enrollButtonText, { color: colors.primary }]}>Enroll</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Empty state */}
        {!isLoading && subjects.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📖</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No subjects yet</Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Subjects will appear here once teachers publish them.
            </Text>
          </View>
        )}

        {isLoading && !refreshing && (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingBottom: 100 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  greeting: { fontSize: FontSizes.xl, fontWeight: '700' },
  headerStats: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  card: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  statEmoji: { fontSize: 24 },
  statValue: { fontSize: FontSizes.xl, fontWeight: '700', marginTop: 4 },
  statLabel: { fontSize: FontSizes.xs, marginTop: 2 },
  errorCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  section: { marginTop: Spacing.xl, paddingHorizontal: Spacing.lg },
  sectionTitle: { fontSize: FontSizes.lg, fontWeight: '700', marginBottom: Spacing.sm },
  subjectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
  subjectInfo: { flex: 1, marginRight: Spacing.md },
  subjectCode: { fontSize: FontSizes.xs, fontWeight: '600', marginBottom: 2 },
  subjectName: { fontSize: FontSizes.md, fontWeight: '600' },
  subjectMeta: { flexDirection: 'row', marginTop: 4 },
  metaText: { fontSize: FontSizes.xs },
  progressBg: { height: 6, borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  startButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  startButtonText: { color: '#fff', fontWeight: '600', fontSize: FontSizes.sm },
  enrollButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
  },
  enrollButtonText: { fontWeight: '600', fontSize: FontSizes.sm },
  emptyState: { alignItems: 'center', paddingTop: 60 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '600', marginTop: Spacing.md },
  emptyText: { fontSize: FontSizes.sm, marginTop: Spacing.xs, textAlign: 'center', paddingHorizontal: 40 },
});
