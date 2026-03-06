/**
 * Teacher Tests Dashboard & Student Chapter-based AI Test View
 */
import React, { useEffect, useCallback, useState, useMemo } from 'react';
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
import ReAnimated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import { useAuthStore } from '@/stores/authStore';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { GlassCard } from '@/components/ui/glass-card';
import { NativeButton } from '@/components/ui/native-button';
import { testsService, TestResponse } from '@/services/tests';
import learnService from '@/services/learn';
import type { SubjectStudent, TestHistoryEntry } from '@/services/learn';

type StatusFilter = 'all' | 'draft' | 'published' | 'unpublished';

interface TopicWithScore {
  id: string;
  name: string;
  description?: string;
  order_index: number;
  total_questions: number;
  best_score?: number;       // 0-100 percentage
  attempts: number;
  last_difficulty?: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function difficultyColor(d?: string) {
  if (d === 'hard') return '#FF3B30';
  if (d === 'medium') return '#FF9500';
  return '#34C759';
}
function scoreColor(pct: number) {
  if (pct >= 80) return '#34C759';
  if (pct >= 60) return '#007AFF';
  if (pct >= 40) return '#FF9500';
  return '#FF3B30';
}

// ─── Chapter card (compact row) ──────────────────────────────────────────────
function ChapterCard({
  topic,
  onStart,
  colors,
  index,
}: {
  topic: TopicWithScore;
  onStart: () => void;
  colors: typeof Colors.light;
  index: number;
}) {
  const hasTaken = topic.attempts > 0;
  const diffColor = difficultyColor(topic.last_difficulty);

  return (
    <ReAnimated.View entering={FadeInDown.delay(index * 60).springify().damping(16)}>
      <View style={[styles.chapterCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* left accent */}
        <View style={[styles.chapterAccent, { backgroundColor: hasTaken ? scoreColor(topic.best_score ?? 0) : colors.border }]} />

        <View style={styles.chapterBody}>
          {/* Row 1: name + difficulty + start button */}
          <View style={styles.chapterRow1}>
            <Text style={styles.chapterEmoji}>📖</Text>
            <Text style={[styles.chapterName, { color: colors.text }]} numberOfLines={1}>
              {topic.name}
            </Text>
            <View style={[styles.diffBadge, { backgroundColor: diffColor + '18' }]}>
              <Text style={[styles.diffText, { color: diffColor }]}>
                {topic.last_difficulty ? topic.last_difficulty.charAt(0).toUpperCase() + topic.last_difficulty.slice(1) : 'Adaptive'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.startBtn, { backgroundColor: hasTaken ? colors.backgroundSecondary : colors.primary }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onStart();
              }}
            >
              <Text style={[styles.startBtnText, { color: hasTaken ? colors.primary : '#FFF' }]}>
                {hasTaken ? '↺' : '▶'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Row 2: meta info */}
          <View style={styles.chapterRow2}>
            <Text style={[styles.chapterMeta, { color: colors.textTertiary }]}>
              {topic.total_questions > 0 ? `${topic.total_questions} questions` : 'Questions ready'}
            </Text>
            {hasTaken ? (
              <Text style={[styles.chapterScore, { color: scoreColor(topic.best_score ?? 0) }]}>
                Best: {Math.round(topic.best_score ?? 0)}%
                {(topic.best_score ?? 0) >= 80 ? ' ✓' : ''}
              </Text>
            ) : (
              <Text style={[styles.chapterMeta, { color: colors.textTertiary }]}>Not started</Text>
            )}
          </View>
        </View>
      </View>
    </ReAnimated.View>
  );
}

export default function TestsDashboard() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { user } = useAuthStore();

  const isStudent = user?.role === 'student';

  // ── Teacher state ───────────────────────────────────────────────────────────
  const [tests, setTests] = useState<TestResponse[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');

  // ── Student state ───────────────────────────────────────────────────────────
  const [subjects, setSubjects] = useState<SubjectStudent[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<SubjectStudent | null>(null);
  const [topics, setTopics] = useState<{ id: string; name: string; description?: string; order_index: number; total_questions: number }[]>([]);
  const [history, setHistory] = useState<TestHistoryEntry[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);

  // ── Shared state ────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Merge topics with history for compact display ───────────────────────────
  const topicsWithScores: TopicWithScore[] = useMemo(() => {
    return topics.map((t) => {
      const attempts = history.filter((h) => h.topic_id === t.id);
      const bestScore =
        attempts.length > 0
          ? Math.max(...attempts.map((h) => (h.score / Math.max(h.total_marks, 1)) * 100))
          : undefined;
      const last = attempts[attempts.length - 1];
      return {
        ...t,
        best_score: bestScore,
        attempts: attempts.length,
        last_difficulty: last?.difficulty,
      };
    });
  }, [topics, history]);

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadStudentData = useCallback(async () => {
    try {
      const subs = await learnService.getAvailableSubjects();
      const enrolled = subs.filter((s) => s.is_enrolled && s.enrollment_status === 'approved');
      setSubjects(enrolled);
      if (enrolled.length > 0) {
        const first = enrolled[0];
        setSelectedSubject((prev) => prev ?? first);
      }
    } catch (e) {
      console.error('Failed to load subjects', e);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadTopicsAndHistory = useCallback(async (subjectId: string) => {
    setTopicsLoading(true);
    try {
      const [topicData, histData] = await Promise.all([
        learnService.getTopics(subjectId),
        learnService.getTestHistory(subjectId, 100),
      ]);
      setTopics(topicData.topics);
      setHistory(histData);
    } catch (e) {
      console.error('Failed to load topics/history', e);
    } finally {
      setTopicsLoading(false);
    }
  }, []);

  const loadTeacherData = useCallback(async () => {
    try {
      const status = filter === 'all' ? undefined : filter;
      const data = await testsService.listTests(status);
      setTests(data);
    } catch (error: any) {
      console.error('Failed to load tests:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => {
    if (isStudent) loadStudentData();
    else loadTeacherData();
  }, [isStudent, loadStudentData, loadTeacherData]);

  useEffect(() => {
    if (selectedSubject) loadTopicsAndHistory(selectedSubject.id);
  }, [selectedSubject, loadTopicsAndHistory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (isStudent) {
      await loadStudentData();
      if (selectedSubject) await loadTopicsAndHistory(selectedSubject.id);
    } else {
      await loadTeacherData();
    }
  }, [isStudent, loadStudentData, loadTeacherData, loadTopicsAndHistory, selectedSubject]);

  // ── Teacher helpers ─────────────────────────────────────────────────────────
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
      case 'draft': return colors.warning;
      case 'published': return colors.success;
      case 'unpublished': return colors.textTertiary;
      default: return colors.textSecondary;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'draft': return 'pencil.circle.fill';
      case 'published': return 'checkmark.circle.fill';
      case 'unpublished': return 'xmark.circle.fill';
      default: return 'questionmark.circle.fill';
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

  // ══════════════════════════════════════════════════════════════════
  // STUDENT VIEW — chapter-based AI tests
  // ══════════════════════════════════════════════════════════════════
  if (isStudent) {
    const totalAttempts = history.length;
    const avgScore =
      totalAttempts > 0
        ? Math.round(
            history.reduce((acc, h) => acc + (h.score / Math.max(h.total_marks, 1)) * 100, 0) /
              totalAttempts
          )
        : 0;
    const chaptersCompleted = topicsWithScores.filter((t) => (t.best_score ?? 0) >= 60).length;

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={styles.studentHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>Chapter Tests</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              AI-generated · Level adaptive · New session each time
            </Text>
          </View>
          <Text style={{ fontSize: 28 }}>🎯</Text>
        </View>

        {/* Stats strip */}
        {subjects.length > 0 && (
          <View style={styles.statsStrip}>
            <View style={[styles.statPill, { backgroundColor: colors.primary + '15' }]}>
              <Text style={[styles.statPillNum, { color: colors.primary }]}>{subjects.length}</Text>
              <Text style={[styles.statPillLabel, { color: colors.textSecondary }]}>Subjects</Text>
            </View>
            <View style={[styles.statPill, { backgroundColor: '#34C75915' }]}>
              <Text style={[styles.statPillNum, { color: '#34C759' }]}>{chaptersCompleted}</Text>
              <Text style={[styles.statPillLabel, { color: colors.textSecondary }]}>Passed</Text>
            </View>
            <View style={[styles.statPill, { backgroundColor: '#FF950015' }]}>
              <Text style={[styles.statPillNum, { color: '#FF9500' }]}>{avgScore}%</Text>
              <Text style={[styles.statPillLabel, { color: colors.textSecondary }]}>Avg Score</Text>
            </View>
          </View>
        )}

        {subjects.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={{ fontSize: 56 }}>📭</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No subjects enrolled</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Enrol in subjects from the Learn tab to take chapter tests here.
            </Text>
          </View>
        ) : (
          <>
            {/* Subject selector pills */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.subjectTabs}
            >
              {subjects.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[
                    styles.subjectTab,
                    {
                      backgroundColor: selectedSubject?.id === s.id ? colors.primary : colors.backgroundSecondary,
                      borderColor: selectedSubject?.id === s.id ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedSubject(s);
                  }}
                >
                  <Text style={[styles.subjectTabText, { color: selectedSubject?.id === s.id ? '#FFF' : colors.text }]}>
                    {s.code}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Chapter list */}
            <ScrollView
              contentContainerStyle={styles.chapterList}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              showsVerticalScrollIndicator={false}
            >
              {selectedSubject && (
                <Text style={[styles.subjectFullName, { color: colors.textSecondary }]}>
                  {selectedSubject.name}
                </Text>
              )}

              {topicsLoading ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 32 }} />
              ) : topicsWithScores.length === 0 ? (
                <View style={styles.emptyChapters}>
                  <Text style={{ fontSize: 40 }}>📂</Text>
                  <Text style={[styles.emptyTitle, { color: colors.text, marginTop: 12 }]}>
                    No chapters yet
                  </Text>
                  <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                    Your teacher hasn't added topics to this subject.
                  </Text>
                </View>
              ) : (
                topicsWithScores.map((topic, i) => (
                  <ChapterCard
                    key={topic.id}
                    topic={topic}
                    index={i}
                    colors={colors}
                    onStart={() => {
                      router.push({
                        pathname: '/(tabs)/learn/lesson',
                        params: {
                          subjectId: selectedSubject!.id,
                          subjectName: selectedSubject!.name,
                          topicId: topic.id,
                        },
                      });
                    }}
                  />
                ))
              )}
            </ScrollView>
          </>
        )}
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
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: Spacing.md, paddingBottom: 100 },

  // ── Shared header / text ─────────────────────────────────────────────────
  title: { fontSize: FontSizes.xxl, fontWeight: '700' },
  subtitle: { fontSize: FontSizes.sm, marginTop: 2 },

  // ── Teacher view ──────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    gap: 6,
  },
  createButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: FontSizes.sm },
  filterRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md, paddingRight: Spacing.md },
  filterChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderRadius: BorderRadius.full, borderWidth: 1,
  },
  filterText: { fontSize: FontSizes.sm, fontWeight: '500' },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  statCard: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md },
  statNumber: { fontSize: FontSizes.xl, fontWeight: '700' },
  statLabel: { fontSize: FontSizes.xs, marginTop: 2 },
  testCard: { marginBottom: Spacing.sm, padding: Spacing.md },
  testHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  testTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  testTitle: { fontSize: FontSizes.md, fontWeight: '600', flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: BorderRadius.full },
  statusText: { fontSize: FontSizes.xs, fontWeight: '600', textTransform: 'capitalize' },
  testSubject: { fontSize: FontSizes.sm, marginBottom: 8, marginLeft: 28 },
  testMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginLeft: 28 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: FontSizes.xs },
  avgScoreBar: { marginTop: 8, marginLeft: 28, paddingHorizontal: 10, paddingVertical: 4, borderRadius: BorderRadius.md, alignSelf: 'flex-start' },
  avgScoreText: { fontSize: FontSizes.xs, fontWeight: '500' },

  // ── Student view: header + stats strip ──────────────────────────────────
  studentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  statsStrip: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  statPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: BorderRadius.lg,
  },
  statPillNum: { fontSize: FontSizes.md, fontWeight: '800' },
  statPillLabel: { fontSize: FontSizes.xs, fontWeight: '500' },

  // ── Subject tabs ─────────────────────────────────────────────────────────
  subjectTabs: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  subjectTab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
  },
  subjectTabText: { fontSize: FontSizes.sm, fontWeight: '600' },

  // ── Chapter list ─────────────────────────────────────────────────────────
  chapterList: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: 100,
    gap: 8,
  },
  subjectFullName: {
    fontSize: FontSizes.xs,
    fontWeight: '500',
    marginBottom: 4,
    paddingLeft: 2,
  },

  // ── Chapter card (compact 2-row layout) ──────────────────────────────────
  chapterCard: {
    flexDirection: 'row',
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  chapterAccent: { width: 4 },
  chapterBody: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
  chapterRow1: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chapterEmoji: { fontSize: 15, width: 20 },
  chapterName: { flex: 1, fontSize: FontSizes.sm, fontWeight: '600' },
  diffBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: BorderRadius.full },
  diffText: { fontSize: 10, fontWeight: '700' },
  startBtn: {
    width: 32, height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startBtnText: { fontSize: 14, fontWeight: '700' },
  chapterRow2: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 26 },
  chapterMeta: { fontSize: 11 },
  chapterScore: { fontSize: 11, fontWeight: '700' },

  // ── Empty states ─────────────────────────────────────────────────────────
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  emptyChapters: { alignItems: 'center', paddingTop: 40, gap: 4 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '600', textAlign: 'center' },
  emptySubtitle: { fontSize: FontSizes.sm, textAlign: 'center', lineHeight: 20 },
});
