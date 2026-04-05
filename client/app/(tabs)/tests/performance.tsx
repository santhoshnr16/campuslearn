/**
 * Test Performance Screen - View student performances for a test
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { GlassCard } from '@/components/ui/glass-card';
import {
  testsService,
  TestPerformanceResponse,
  TestSubmissionResponse,
  QuestionPerformance,
} from '@/services/tests';

export default function PerformanceScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { testId } = useLocalSearchParams<{ testId: string }>();
  const insets = useSafeAreaInsets();

  const [performance, setPerformance] = useState<TestPerformanceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'students' | 'questions'>('students');
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);

  const loadPerformance = useCallback(async () => {
    if (!testId) return;
    try {
      const data = await testsService.getTestPerformance(testId);
      setPerformance(data);
    } catch (error) {
      console.error('Failed to load performance:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [testId]);

  useEffect(() => {
    loadPerformance();
  }, [loadPerformance]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPerformance();
  }, [loadPerformance]);

  const getScoreColor = (percentage: number) => {
    if (percentage >= 80) return colors.success;
    if (percentage >= 50) return colors.warning;
    return colors.error;
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 75) return colors.success;
    if (accuracy >= 50) return colors.warning;
    return colors.error;
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!performance) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Text style={{ color: colors.error }}>Failed to load performance data</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: 110 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Test title */}
        <Text style={[styles.title, { color: colors.text }]}>{performance.test_title}</Text>

        {/* Summary Stats */}
        <View style={styles.statsGrid}>
          <GlassCard style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.primary }]}>
              {performance.total_submissions}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textTertiary }]}>Submissions</Text>
          </GlassCard>
          <GlassCard style={styles.statCard}>
            <Text style={[styles.statValue, { color: getScoreColor(performance.average_percentage) }]}>
              {performance.average_percentage}%
            </Text>
            <Text style={[styles.statLabel, { color: colors.textTertiary }]}>Avg Score</Text>
          </GlassCard>
          <GlassCard style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.success }]}>
              {performance.highest_score}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textTertiary }]}>Highest</Text>
          </GlassCard>
          <GlassCard style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.error }]}>
              {performance.lowest_score}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textTertiary }]}>Lowest</Text>
          </GlassCard>
        </View>

        {/* Score Distribution Bar */}
        {performance.submissions.length > 0 && (
          <GlassCard style={styles.distributionCard}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Score Distribution</Text>
            <View style={styles.distributionBar}>
              {(() => {
                const ranges = [
                  { label: '90-100%', min: 90, max: 100, color: colors.success },
                  { label: '70-89%', min: 70, max: 89, color: '#34C759' },
                  { label: '50-69%', min: 50, max: 69, color: colors.warning },
                  { label: '0-49%', min: 0, max: 49, color: colors.error },
                ];
                const total = performance.submissions.length;
                return ranges.map((range) => {
                  const count = performance.submissions.filter(
                    (s) => s.percentage >= range.min && s.percentage <= range.max
                  ).length;
                  if (count === 0) return null;
                  return (
                    <View
                      key={range.label}
                      style={[
                        styles.distSegment,
                        {
                          backgroundColor: range.color,
                          flex: count / total,
                        },
                      ]}
                    />
                  );
                });
              })()}
            </View>
            <View style={styles.legendRow}>
              {[
                { label: '90-100%', color: colors.success },
                { label: '70-89%', color: '#34C759' },
                { label: '50-69%', color: colors.warning },
                { label: '0-49%', color: colors.error },
              ].map((item) => (
                <View key={item.label} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                  <Text style={[styles.legendText, { color: colors.textTertiary }]}>{item.label}</Text>
                </View>
              ))}
            </View>
          </GlassCard>
        )}

        {/* Toggle View */}
        <View style={styles.viewToggle}>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              {
                backgroundColor: view === 'students' ? colors.primary : 'transparent',
                borderColor: colors.primary,
              },
            ]}
            onPress={() => setView('students')}
          >
            <Text
              style={[
                styles.toggleText,
                { color: view === 'students' ? '#FFFFFF' : colors.primary },
              ]}
            >
              Students
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              {
                backgroundColor: view === 'questions' ? colors.primary : 'transparent',
                borderColor: colors.primary,
              },
            ]}
            onPress={() => setView('questions')}
          >
            <Text
              style={[
                styles.toggleText,
                { color: view === 'questions' ? '#FFFFFF' : colors.primary },
              ]}
            >
              Questions
            </Text>
          </TouchableOpacity>
        </View>

        {/* Student View */}
        {view === 'students' && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Student Results ({performance.submissions.length})
            </Text>
            {performance.submissions.map((sub: TestSubmissionResponse, idx: number) => (
              <TouchableOpacity
                key={sub.id}
                onPress={() =>
                  setExpandedStudent(expandedStudent === sub.id ? null : sub.id)
                }
              >
                <GlassCard style={styles.studentCard}>
                  <View style={styles.studentHeader}>
                    <View style={styles.rankBadge}>
                      <Text style={[styles.rankText, { color: colors.primary }]}>#{idx + 1}</Text>
                    </View>
                    <View style={styles.studentInfo}>
                      <Text style={[styles.studentName, { color: colors.text }]}>
                        {sub.student_name || sub.student_username || 'Unknown'}
                      </Text>
                      <Text style={[styles.studentMeta, { color: colors.textTertiary }]}>
                        {sub.score}/{sub.total_marks} marks
                        {sub.time_taken_seconds
                          ? ` • ${Math.floor(sub.time_taken_seconds / 60)}m ${sub.time_taken_seconds % 60}s`
                          : ''}
                      </Text>
                    </View>
                    <View style={styles.scoreCircle}>
                      <Text
                        style={[
                          styles.scorePercentage,
                          { color: getScoreColor(sub.percentage) },
                        ]}
                      >
                        {sub.percentage}%
                      </Text>
                    </View>
                  </View>

                  {/* Expanded: show individual answers */}
                  {expandedStudent === sub.id && sub.answers && (
                    <View style={styles.answersDetail}>
                      {sub.answers.map((ans: any, aIdx: number) => (
                        <View
                          key={aIdx}
                          style={[
                            styles.answerRow,
                            {
                              backgroundColor: ans.is_correct
                                ? colors.success + '10'
                                : colors.error + '10',
                            },
                          ]}
                        >
                          <IconSymbol
                            name={ans.is_correct ? 'checkmark.circle.fill' : 'xmark.circle.fill'}
                            size={16}
                            color={ans.is_correct ? colors.success : colors.error}
                          />
                          <Text
                            style={[styles.answerText, { color: colors.textSecondary }]}
                            numberOfLines={1}
                          >
                            Q{aIdx + 1}: {ans.selected_answer}
                            {!ans.is_correct && ` (correct: ${ans.correct_answer})`}
                          </Text>
                          <Text style={[styles.answerMarks, { color: colors.textTertiary }]}>
                            {ans.marks_obtained}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </GlassCard>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Question Analysis View */}
        {view === 'questions' && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Question Analysis ({performance.question_performance.length})
            </Text>
            {performance.question_performance.map((qp: QuestionPerformance, idx: number) => (
              <GlassCard key={qp.question_id} style={styles.questionCard}>
                <View style={styles.questionHeader}>
                  <View style={[styles.qIndex, { backgroundColor: colors.primary + '15' }]}>
                    <Text style={[styles.qIndexText, { color: colors.primary }]}>Q{idx + 1}</Text>
                  </View>
                  <View style={styles.qAccuracy}>
                    <Text
                      style={[
                        styles.qAccuracyValue,
                        { color: getAccuracyColor(qp.accuracy) },
                      ]}
                    >
                      {qp.accuracy}%
                    </Text>
                    <Text style={[styles.qAccuracyLabel, { color: colors.textTertiary }]}>
                      accuracy
                    </Text>
                  </View>
                </View>
                <Text style={[styles.qText, { color: colors.text }]} numberOfLines={2}>
                  {qp.question_text}
                </Text>
                <View style={styles.qStats}>
                  <Text style={[styles.qStatText, { color: colors.textTertiary }]}>
                    {qp.correct_count}/{qp.total_attempts} correct
                  </Text>
                  {qp.average_time_seconds && (
                    <Text style={[styles.qStatText, { color: colors.textTertiary }]}>
                      Avg time: {Math.round(qp.average_time_seconds)}s
                    </Text>
                  )}
                </View>
                {/* Accuracy bar */}
                <View style={[styles.accuracyBar, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.accuracyFill,
                      {
                        width: `${qp.accuracy}%`,
                        backgroundColor: getAccuracyColor(qp.accuracy),
                      },
                    ]}
                  />
                </View>
              </GlassCard>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: Spacing.md, paddingBottom: 100 },
  title: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  statValue: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: FontSizes.xs,
    marginTop: 2,
  },
  distributionCard: {
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    fontSize: FontSizes.md,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  distributionBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  distSegment: {
    height: '100%',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: FontSizes.xs,
  },
  viewToggle: {
    flexDirection: 'row',
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    gap: Spacing.xs,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: BorderRadius.md,
  },
  toggleText: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  section: {
    gap: Spacing.sm,
  },
  studentCard: {
    padding: Spacing.md,
  },
  studentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankText: {
    fontSize: FontSizes.xs,
    fontWeight: '700',
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  studentMeta: {
    fontSize: FontSizes.xs,
    marginTop: 2,
  },
  scoreCircle: {
    paddingHorizontal: Spacing.sm,
  },
  scorePercentage: {
    fontSize: FontSizes.lg,
    fontWeight: '700',
  },
  answersDetail: {
    marginTop: Spacing.sm,
    gap: 4,
  },
  answerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.sm,
  },
  answerText: {
    fontSize: FontSizes.xs,
    flex: 1,
  },
  answerMarks: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
  },
  questionCard: {
    padding: Spacing.md,
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  qIndex: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.md,
  },
  qIndexText: {
    fontSize: FontSizes.sm,
    fontWeight: '700',
  },
  qAccuracy: {
    alignItems: 'flex-end',
  },
  qAccuracyValue: {
    fontSize: FontSizes.md,
    fontWeight: '700',
  },
  qAccuracyLabel: {
    fontSize: FontSizes.xs,
  },
  qText: {
    fontSize: FontSizes.sm,
    lineHeight: 20,
    marginBottom: 6,
  },
  qStats: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: 6,
  },
  qStatText: {
    fontSize: FontSizes.xs,
  },
  accuracyBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  accuracyFill: {
    height: '100%',
    borderRadius: 3,
  },
});
