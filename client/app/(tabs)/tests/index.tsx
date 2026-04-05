/**
 * Teacher Tests Dashboard & Student Gamified Tests View
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
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import ReAnimated, {
  FadeInDown,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import { useAuthStore } from '@/stores/authStore';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { GlassCard } from '@/components/ui/glass-card';
import { NativeButton } from '@/components/ui/native-button';
import { testsService, TestResponse } from '@/services/tests';

type StatusFilter = 'all' | 'draft' | 'published' | 'unpublished';

export default function TestsDashboard() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { user } = useAuthStore();

  const isStudent = user?.role === 'student';

  const [tests, setTests] = useState<TestResponse[]>([]);
  const [studentTests, setStudentTests] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');

  const loadTests = useCallback(async () => {
    try {
      if (isStudent) {
        const data = await testsService.getStudentTests();
        setStudentTests(data);
      } else {
        const status = filter === 'all' ? undefined : filter;
        const data = await testsService.listTests(status);
        setTests(data);
      }
    } catch (error: any) {
      console.error('Failed to load tests:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [filter, isStudent]);

  useEffect(() => {
    loadTests();
  }, [loadTests]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTests();
  }, [loadTests]);

  const handleDelete = async (testId: string) => {
    Alert.alert('Delete Test', 'Are you sure you want to delete this test?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await testsService.deleteTest(testId);
            setTests((prev) => prev.filter((t) => t.id !== testId));
          } catch (error: any) {
            Alert.alert('Error', error?.message || 'Failed to delete test');
          }
        },
      },
    ]);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft':
        return colors.warning;
      case 'published':
        return colors.success;
      case 'unpublished':
        return colors.textTertiary;
      default:
        return colors.textSecondary;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'draft':
        return 'pencil.circle.fill';
      case 'published':
        return 'checkmark.circle.fill';
      case 'unpublished':
        return 'xmark.circle.fill';
      default:
        return 'questionmark.circle.fill';
    }
  };

  const filters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Drafts' },
    { key: 'published', label: 'Published' },
    { key: 'unpublished', label: 'Unpublished' },
  ];

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // ====== Student View ======
  if (isStudent) {
    const availableTests = studentTests.filter((t: any) => !t.has_submitted);
    const completedTests = studentTests.filter((t: any) => t.has_submitted);

    const getDifficultyColor = (test: any) => {
      const q = test.total_questions || 0;
      if (q <= 5) return '#34C759';
      if (q <= 15) return '#FF9500';
      return '#FF3B30';
    };
    const getDifficultyLabel = (test: any) => {
      const q = test.total_questions || 0;
      if (q <= 5) return 'Quick';
      if (q <= 15) return 'Standard';
      return 'Challenge';
    };

    const getScoreColor = (pct: number) => {
      if (pct >= 80) return '#34C759';
      if (pct >= 60) return '#007AFF';
      if (pct >= 40) return '#FF9500';
      return '#FF3B30';
    };
    const getScoreEmoji = (pct: number) => {
      if (pct >= 90) return '🏆';
      if (pct >= 75) return '🌟';
      if (pct >= 60) return '👍';
      if (pct >= 40) return '💪';
      return '📚';
    };

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Gamified Header */}
          <View style={styles.studentHeader}>
            <Text style={{ fontSize: 32 }}>🎯</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>My Tests</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                {availableTests.length > 0
                  ? `${availableTests.length} test${availableTests.length > 1 ? 's' : ''} waiting for you!`
                  : completedTests.length > 0
                    ? 'All caught up! Great work!'
                    : 'Tests will appear here when published'}
              </Text>
            </View>
          </View>

          {/* Stats Summary */}
          {studentTests.length > 0 && (
            <View style={styles.studentStatsRow}>
              <View style={[styles.studentStatCard, { backgroundColor: colors.primary + '12' }]}>
                <Text style={{ fontSize: 22 }}>📝</Text>
                <Text style={[styles.studentStatNumber, { color: colors.primary }]}>{availableTests.length}</Text>
                <Text style={[styles.studentStatLabel, { color: colors.textSecondary }]}>Pending</Text>
              </View>
              <View style={[styles.studentStatCard, { backgroundColor: '#34C75912' }]}>
                <Text style={{ fontSize: 22 }}>✅</Text>
                <Text style={[styles.studentStatNumber, { color: '#34C759' }]}>{completedTests.length}</Text>
                <Text style={[styles.studentStatLabel, { color: colors.textSecondary }]}>Done</Text>
              </View>
              <View style={[styles.studentStatCard, { backgroundColor: '#FF950012' }]}>
                <Text style={{ fontSize: 22 }}>📊</Text>
                <Text style={[styles.studentStatNumber, { color: '#FF9500' }]}>
                  {completedTests.length > 0
                    ? Math.round(completedTests.reduce((acc: number, t: any) => acc + (t.submission_percentage || 0), 0) / completedTests.length)
                    : 0}%
                </Text>
                <Text style={[styles.studentStatLabel, { color: colors.textSecondary }]}>Avg Score</Text>
              </View>
            </View>
          )}

          {studentTests.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={{ fontSize: 64 }}>📭</Text>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No tests yet</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Tests published by your teachers will appear here once you're enrolled and approved.
              </Text>
            </View>
          ) : (
            <>
              {/* Available Tests */}
              {availableTests.length > 0 && (
                <View style={styles.sectionBlock}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>🔥 Ready to Take</Text>
                  {availableTests.map((test: any, index: number) => (
                    <ReAnimated.View
                      key={test.id}
                      entering={FadeInDown.delay(index * 80).springify().damping(15).stiffness(150)}
                    >
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          router.push({ pathname: '/(tabs)/tests/detail', params: { testId: test.id } });
                        }}
                      >
                        <View style={[styles.gamifiedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                          {/* Gradient accent bar */}
                          <LinearGradient
                            colors={[colors.primary, colors.secondary]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.accentBar}
                          />
                          <View style={styles.gamifiedCardContent}>
                            {/* Top Row: Title + Difficulty */}
                            <View style={styles.gamifiedTopRow}>
                              <Text style={[styles.gamifiedTitle, { color: colors.text }]} numberOfLines={2}>
                                {test.title}
                              </Text>
                              <View style={[styles.difficultyBadge, { backgroundColor: getDifficultyColor(test) + '18' }]}>
                                <Text style={[styles.difficultyText, { color: getDifficultyColor(test) }]}>
                                  {getDifficultyLabel(test)}
                                </Text>
                              </View>
                            </View>

                            {/* Subject */}
                            {test.subject_name && (
                              <Text style={[styles.gamifiedSubject, { color: colors.textSecondary }]} numberOfLines={1}>
                                {test.subject_code} · {test.subject_name}
                              </Text>
                            )}

                            {/* Info chips */}
                            <View style={styles.chipRow}>
                              <View style={[styles.infoChip, { backgroundColor: colors.background }]}>
                                <Text style={styles.chipEmoji}>❓</Text>
                                <Text style={[styles.chipText, { color: colors.text }]}>{test.total_questions}Q</Text>
                              </View>
                              <View style={[styles.infoChip, { backgroundColor: colors.background }]}>
                                <Text style={styles.chipEmoji}>⭐</Text>
                                <Text style={[styles.chipText, { color: colors.text }]}>{test.total_marks} pts</Text>
                              </View>
                              {test.duration_minutes && (
                                <View style={[styles.infoChip, { backgroundColor: colors.background }]}>
                                  <Text style={styles.chipEmoji}>⏱️</Text>
                                  <Text style={[styles.chipText, { color: colors.text }]}>{test.duration_minutes}m</Text>
                                </View>
                              )}
                            </View>

                            {/* Start button area */}
                            <View style={[styles.startRow, { borderTopColor: colors.border }]}>
                              <View style={[styles.startButton, { backgroundColor: colors.primary }]}>
                                <Text style={styles.startButtonText}>Start Test →</Text>
                              </View>
                            </View>
                          </View>
                        </View>
                      </TouchableOpacity>
                    </ReAnimated.View>
                  ))}
                </View>
              )}

              {/* Completed Tests */}
              {completedTests.length > 0 && (
                <View style={styles.sectionBlock}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>✅ Completed</Text>
                  {completedTests.map((test: any, index: number) => {
                    const pct = Math.round(test.submission_percentage || 0);
                    return (
                      <ReAnimated.View
                        key={test.id}
                        entering={FadeInDown.delay((availableTests.length + index) * 80).springify().damping(15).stiffness(150)}
                      >
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            router.push({ pathname: '/(tabs)/tests/detail', params: { testId: test.id } });
                          }}
                        >
                          <View style={[styles.gamifiedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            {/* Accent bar based on score */}
                            <LinearGradient
                              colors={[getScoreColor(pct), getScoreColor(pct) + '80']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.accentBar}
                            />
                            <View style={styles.gamifiedCardContent}>
                              <View style={styles.gamifiedTopRow}>
                                <View style={{ flex: 1 }}>
                                  <Text style={[styles.gamifiedTitle, { color: colors.text }]} numberOfLines={2}>
                                    {test.title}
                                  </Text>
                                  {test.subject_name && (
                                    <Text style={[styles.gamifiedSubject, { color: colors.textSecondary }]} numberOfLines={1}>
                                      {test.subject_code} · {test.subject_name}
                                    </Text>
                                  )}
                                </View>
                                {/* Score circle */}
                                <View style={[styles.scoreCircleMini, { borderColor: getScoreColor(pct) }]}>
                                  <Text style={{ fontSize: 16 }}>{getScoreEmoji(pct)}</Text>
                                  <Text style={[styles.scoreCircleText, { color: getScoreColor(pct) }]}>{pct}%</Text>
                                </View>
                              </View>

                              {/* Progress bar */}
                              <View style={[styles.scoreProgressBg, { backgroundColor: colors.border }]}>
                                <View style={[styles.scoreProgressFill, { width: `${pct}%`, backgroundColor: getScoreColor(pct) }]} />
                              </View>

                              {/* Info chips */}
                              <View style={styles.chipRow}>
                                <View style={[styles.infoChip, { backgroundColor: colors.background }]}>
                                  <Text style={styles.chipEmoji}>❓</Text>
                                  <Text style={[styles.chipText, { color: colors.text }]}>{test.total_questions}Q</Text>
                                </View>
                                <View style={[styles.infoChip, { backgroundColor: colors.background }]}>
                                  <Text style={styles.chipEmoji}>⭐</Text>
                                  <Text style={[styles.chipText, { color: colors.text }]}>{test.total_marks} pts</Text>
                                </View>
                                <View style={[styles.infoChip, { backgroundColor: getScoreColor(pct) + '15' }]}>
                                  <Text style={[styles.chipText, { color: getScoreColor(pct), fontWeight: '700' }]}>
                                    {pct >= 80 ? 'Excellent!' : pct >= 60 ? 'Good' : pct >= 40 ? 'Fair' : 'Retry'}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          </View>
                        </TouchableOpacity>
                      </ReAnimated.View>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ====== Teacher View ======
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>Tests</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Create and manage assessments
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.createButton, { backgroundColor: colors.primary }]}
            onPress={() => router.push('/(tabs)/tests/create')}
          >
            <IconSymbol name="plus" size={20} color="#FFFFFF" />
            <Text style={styles.createButtonText}>New Test</Text>
          </TouchableOpacity>
        </View>

        {/* Status Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {filters.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    filter === f.key ? colors.primary : colors.backgroundSecondary,
                  borderColor: filter === f.key ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setFilter(f.key)}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: filter === f.key ? '#FFFFFF' : colors.textSecondary },
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Summary Stats */}
        <View style={styles.statsRow}>
          <GlassCard style={styles.statCard}>
            <Text style={[styles.statNumber, { color: colors.primary }]}>
              {tests.length}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Total</Text>
          </GlassCard>
          <GlassCard style={styles.statCard}>
            <Text style={[styles.statNumber, { color: colors.success }]}>
              {tests.filter((t) => t.status === 'published').length}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Published</Text>
          </GlassCard>
          <GlassCard style={styles.statCard}>
            <Text style={[styles.statNumber, { color: colors.warning }]}>
              {tests.filter((t) => t.status === 'draft').length}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Drafts</Text>
          </GlassCard>
        </View>

        {/* Tests List */}
        {tests.length === 0 ? (
          <View style={styles.emptyState}>
            <IconSymbol name="doc.text.fill" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No tests yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Create your first test to get started
            </Text>
            <NativeButton
              title="Create Test"
              onPress={() => router.push('/(tabs)/tests/create')}
              variant="primary"
            />
          </View>
        ) : (
          tests.map((test) => (
            <TouchableOpacity
              key={test.id}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/tests/detail',
                  params: { testId: test.id },
                })
              }
              onLongPress={() => {
                if (test.status !== 'published') handleDelete(test.id);
              }}
            >
              <GlassCard style={styles.testCard}>
                <View style={styles.testHeader}>
                  <View style={styles.testTitleRow}>
                    <IconSymbol
                      name={getStatusIcon(test.status)}
                      size={20}
                      color={getStatusColor(test.status)}
                    />
                    <Text style={[styles.testTitle, { color: colors.text }]} numberOfLines={1}>
                      {test.title}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: getStatusColor(test.status) + '20' },
                    ]}
                  >
                    <Text
                      style={[styles.statusText, { color: getStatusColor(test.status) }]}
                    >
                      {test.status}
                    </Text>
                  </View>
                </View>

                {test.subject_name && (
                  <Text style={[styles.testSubject, { color: colors.textSecondary }]}>
                    {test.subject_code} - {test.subject_name}
                  </Text>
                )}

                <View style={styles.testMeta}>
                  <View style={styles.metaItem}>
                    <IconSymbol name="doc.text" size={14} color={colors.textTertiary} />
                    <Text style={[styles.metaText, { color: colors.textTertiary }]}>
                      {test.total_questions} questions
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <IconSymbol name="star.fill" size={14} color={colors.textTertiary} />
                    <Text style={[styles.metaText, { color: colors.textTertiary }]}>
                      {test.total_marks} marks
                    </Text>
                  </View>
                  {test.duration_minutes && (
                    <View style={styles.metaItem}>
                      <IconSymbol name="clock" size={14} color={colors.textTertiary} />
                      <Text style={[styles.metaText, { color: colors.textTertiary }]}>
                        {test.duration_minutes} min
                      </Text>
                    </View>
                  )}
                  {test.submissions_count > 0 && (
                    <View style={styles.metaItem}>
                      <IconSymbol name="person.2.fill" size={14} color={colors.primary} />
                      <Text style={[styles.metaText, { color: colors.primary }]}>
                        {test.submissions_count} submissions
                      </Text>
                    </View>
                  )}
                </View>

                {test.average_score !== null && test.average_score !== undefined && (
                  <View style={[styles.avgScoreBar, { backgroundColor: colors.backgroundSecondary }]}>
                    <Text style={[styles.avgScoreText, { color: colors.textSecondary }]}>
                      Avg Score: {test.average_score}%
                    </Text>
                  </View>
                )}
              </GlassCard>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: Spacing.md,
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: FontSizes.xxl,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: FontSizes.sm,
    marginTop: 2,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    gap: 6,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: FontSizes.sm,
  },
  filterRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
    paddingRight: Spacing.md,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  filterText: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  statNumber: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: FontSizes.xs,
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: Spacing.md,
  },
  emptyTitle: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: FontSizes.sm,
    textAlign: 'center',
  },
  testCard: {
    marginBottom: Spacing.sm,
    padding: Spacing.md,
  },
  testHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  testTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  testTitle: {
    fontSize: FontSizes.md,
    fontWeight: '600',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  statusText: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  testSubject: {
    fontSize: FontSizes.sm,
    marginBottom: 8,
    marginLeft: 28,
  },
  testMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginLeft: 28,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: FontSizes.xs,
  },
  avgScoreBar: {
    marginTop: 8,
    marginLeft: 28,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.md,
    alignSelf: 'flex-start',
  },
  avgScoreText: {
    fontSize: FontSizes.xs,
    fontWeight: '500',
  },
  // ====== Gamified Student Styles ======
  studentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  studentStatsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  studentStatCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    gap: 2,
  },
  studentStatNumber: {
    fontSize: FontSizes.xl,
    fontWeight: '800',
  },
  studentStatLabel: {
    fontSize: FontSizes.xs,
    fontWeight: '500',
  },
  sectionBlock: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSizes.lg,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  gamifiedCard: {
    flexDirection: 'row',
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    marginBottom: Spacing.md,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  accentBar: {
    width: 5,
  },
  gamifiedCardContent: {
    flex: 1,
    padding: Spacing.md,
    gap: 8,
  },
  gamifiedTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  gamifiedTitle: {
    fontSize: FontSizes.md,
    fontWeight: '700',
    flex: 1,
  },
  gamifiedSubject: {
    fontSize: FontSizes.xs,
  },
  difficultyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  difficultyText: {
    fontSize: FontSizes.xs,
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  infoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BorderRadius.md,
    gap: 4,
  },
  chipEmoji: {
    fontSize: 12,
  },
  chipText: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
  },
  startRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
    alignItems: 'flex-end',
  },
  startButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: BorderRadius.lg,
  },
  startButtonText: {
    color: '#FFF',
    fontSize: FontSizes.sm,
    fontWeight: '700',
  },
  scoreCircleMini: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 0,
  },
  scoreCircleText: {
    fontSize: FontSizes.xs,
    fontWeight: '800',
  },
  scoreProgressBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  scoreProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
});
