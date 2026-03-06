/**
 * Student Learn Dashboard - Duolingo-style lesson path with gamification
 * Features: Sinusoidal lesson path, animated star nodes, parallax scrolling
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
  Dimensions,
} from 'react-native';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import { useLearningStore } from '@/stores/learningStore';
import { useAuthStore } from '@/stores/authStore';
import { XPBar, StreakCounter, HeartsDisplay } from '@/components/gamification';
import type { SubjectStudent } from '@/services/learn';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NODE_SIZE = 68;
const NODE_SPACING = 120; // vertical spacing between node centres
// The centre X of the screen
const CENTER_X = SCREEN_WIDTH / 2;
// How far left/right the nodes swing
const AMPLITUDE = SCREEN_WIDTH * 0.22;

// Spring configs
const SPRING_BOUNCY = { damping: 10, stiffness: 200, mass: 0.5 };

interface LessonNode {
  id: string;
  title: string;
  status: 'locked' | 'current' | 'completed';
  subjectId: string;
  subjectName: string;
  index: number;
  xp: number;
}

// Returns X position for a node at a given index (sinusoidal path)
function nodeX(index: number): number {
  // sin(index * 90deg) gives: 0, 1, 0, -1, 0, 1, ...
  return CENTER_X + AMPLITUDE * Math.sin((index * Math.PI) / 2);
}

// ── Animated Lesson Node ──────────────────────────────────────────────────────
const LessonNodeComponent = React.memo(({
  node,
  onPress,
  colors,
}: {
  node: LessonNode;
  onPress: () => void;
  colors: typeof Colors.light;
}) => {
  const pulseScale = useSharedValue(1);
  const pressScale = useSharedValue(1);

  useEffect(() => {
    if (node.status === 'current') {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.10, { duration: 900 }),
          withTiming(1.00, { duration: 900 })
        ),
        -1,
        true
      );
    } else {
      pulseScale.value = 1;
    }
  }, [node.status]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value * pressScale.value }],
  }));

  const handlePress = () => {
    if (node.status === 'locked') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    pressScale.value = withSequence(
      withSpring(0.88, SPRING_BOUNCY),
      withSpring(1.00, SPRING_BOUNCY)
    );
    onPress();
  };

  const getNodeStyle = () => {
    switch (node.status) {
      case 'completed': return { bg: '#34C759', border: '#2BA84A', icon: '⭐' };
      case 'current':   return { bg: colors.primary, border: colors.primary, icon: '▶' };
      case 'locked':    return { bg: colors.backgroundSecondary, border: colors.border, icon: '🔒' };
    }
  };
  const ns = getNodeStyle();

  const x = nodeX(node.index);

  return (
    <View
      style={[
        styles.nodeWrapper,
        {
          left: x - NODE_SIZE / 2 - 60, // -60 to account for label width
          top: node.index * NODE_SPACING,
        },
      ]}
    >
      <ReAnimated.View style={animatedStyle}>
        <TouchableOpacity
          onPress={handlePress}
          activeOpacity={node.status === 'locked' ? 1 : 0.75}
          style={[
            styles.lessonNode,
            {
              backgroundColor: ns.bg,
              borderColor: ns.border,
              shadowColor: node.status === 'current' ? colors.primary : 'transparent',
              shadowOpacity: node.status === 'current' ? 0.45 : 0,
            },
          ]}
        >
          <Text style={styles.nodeIcon}>{ns.icon}</Text>
          {node.status === 'completed' && (
            <View style={styles.checkBadge}>
              <Text style={styles.checkMark}>✓</Text>
            </View>
          )}
        </TouchableOpacity>
      </ReAnimated.View>

      {/* Label to the right of the node */}
      <View style={[styles.nodeLabel, { backgroundColor: colors.backgroundSecondary }]}>
        <Text style={[styles.nodeLabelText, { color: colors.text }]} numberOfLines={1}>
          {node.title}
        </Text>
        {node.status === 'completed' && (
          <Text style={[styles.nodeXP, { color: '#34C759' }]}>+{node.xp} XP</Text>
        )}
      </View>
    </View>
  );
});

// ── Connecting dot-line between consecutive nodes ─────────────────────────────
const ConnectorLine = React.memo(({
  fromIndex,
  toIndex,
  completed,
  colors,
}: {
  fromIndex: number;
  toIndex: number;
  completed: boolean;
  colors: typeof Colors.light;
}) => {
  const x1 = nodeX(fromIndex);
  const y1 = fromIndex * NODE_SPACING + NODE_SIZE / 2;
  const x2 = nodeX(toIndex);
  const y2 = toIndex * NODE_SPACING + NODE_SIZE / 2;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return (
    <View
      style={{
        position: 'absolute',
        left: x1,
        top: y1,
        width: length,
        height: 4,
        borderRadius: 2,
        backgroundColor: completed ? '#34C759' : colors.border,
        transform: [
          { translateX: 0 },
          { translateY: -2 },
          { rotate: `${angle}deg` },
          { translateX: 0 },
        ],
        transformOrigin: '0 50%',
        opacity: 0.7,
      }}
    />
  );
});

// ── Main Component ─────────────────────────────────────────────────────────────
export default function LearnDashboard() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<SubjectStudent | null>(null);

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

  useEffect(() => {
    const enrolled = subjects.filter(s => s.is_enrolled);
    if (enrolled.length > 0 && !selectedSubject) {
      setSelectedSubject(enrolled[0]);
    }
  }, [subjects]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // Generate lesson nodes from selected subject
  const lessonNodes: LessonNode[] = useMemo(() => {
    if (!selectedSubject) return [];
    const totalLessons = Math.max((selectedSubject.total_topics || 3) * 3, 8);
    const completedLessons = Math.floor(((selectedSubject.mastery || 0) / 100) * totalLessons);
    const lessonTitles = [
      'Introduction', 'Basics', 'Core Concepts', 'Practice I',
      'Deep Dive', 'Applications', 'Practice II', 'Review',
      'Advanced', 'Expert', 'Mastery', 'Final',
    ];
    return Array.from({ length: totalLessons }, (_, i) => ({
      id: `lesson-${selectedSubject.id}-${i}`,
      title: lessonTitles[i % lessonTitles.length],
      status: (i < completedLessons ? 'completed' : i === completedLessons ? 'current' : 'locked') as LessonNode['status'],
      subjectId: selectedSubject.id,
      subjectName: selectedSubject.name,
      index: i,
      xp: 10 + (i % 3) * 5,
    }));
  }, [selectedSubject]);

  const handleNodePress = (node: LessonNode) => {
    if (node.status === 'locked') return;
    router.push({
      pathname: '/(tabs)/learn/lesson',
      params: { subjectId: node.subjectId, subjectName: node.subjectName },
    });
  };

  const handleSubjectSelect = async (subject: SubjectStudent) => {
    if (!subject.is_enrolled) {
      const success = await enrollInSubject(subject.id);
      if (!success) return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedSubject(subject);
  };

  const enrolledSubjects = subjects.filter(s => s.is_enrolled);
  const availableSubjects = subjects.filter(s => !s.is_enrolled);
  const pathHeight = lessonNodes.length * NODE_SPACING + NODE_SIZE + 200;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.greeting, { color: colors.text }]}>
              Hey, {user?.full_name?.split(' ')[0] || 'Learner'} 👋
            </Text>
            <Text style={[styles.subGreeting, { color: colors.textSecondary }]}>
              Ready to learn today?
            </Text>
          </View>
          <View style={styles.headerStats}>
            <StreakCounter streak={profile?.streak_count ?? 0} compact />
            <HeartsDisplay hearts={profile?.hearts ?? 5} compact />
          </View>
        </View>
        {profile && (
          <View style={[styles.xpCard, { backgroundColor: colors.backgroundSecondary }]}>
            <XPBar xpTotal={profile.xp_total} level={profile.current_level} />
          </View>
        )}
      </View>

      {/* Subject Pills */}
      {subjects.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subjectPills}
        >
          {enrolledSubjects.map(subject => (
            <TouchableOpacity
              key={subject.id}
              style={[
                styles.subjectPill,
                {
                  backgroundColor: selectedSubject?.id === subject.id ? colors.primary : colors.backgroundSecondary,
                  borderColor: selectedSubject?.id === subject.id ? colors.primary : colors.border,
                },
              ]}
              onPress={() => handleSubjectSelect(subject)}
            >
              <Text style={[styles.subjectPillText, { color: selectedSubject?.id === subject.id ? '#FFF' : colors.text }]}>
                {subject.code}
              </Text>
            </TouchableOpacity>
          ))}
          {availableSubjects.map(subject => (
            <TouchableOpacity
              key={subject.id}
              style={[styles.subjectPill, styles.enrollPill, { borderColor: colors.primary }]}
              onPress={() => handleSubjectSelect(subject)}
            >
              <Text style={[styles.subjectPillText, { color: colors.primary }]}>+ {subject.code}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Lesson Path */}
      {selectedSubject ? (
        <ScrollView
          style={styles.pathScroll}
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Subject header */}
          <View style={styles.pathHeader}>
            <Text style={[styles.pathTitle, { color: colors.text }]}>{selectedSubject.name}</Text>
            <View style={styles.progressRow}>
              <View style={[styles.progressBg, { backgroundColor: colors.border }]}>
                <View style={[styles.progressFill, { width: `${Math.min(selectedSubject.mastery || 0, 100)}%` }]} />
              </View>
              <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
                {Math.round(selectedSubject.mastery || 0)}%
              </Text>
            </View>
          </View>

          {/* Absolute-positioned path canvas */}
          <View style={[styles.pathCanvas, { height: pathHeight, width: SCREEN_WIDTH }]}>
            {/* Connector lines (behind nodes) */}
            {lessonNodes.map((node, i) =>
              i < lessonNodes.length - 1 ? (
                <ConnectorLine
                  key={`line-${i}`}
                  fromIndex={i}
                  toIndex={i + 1}
                  completed={node.status === 'completed'}
                  colors={colors}
                />
              ) : null
            )}
            {/* Nodes */}
            {lessonNodes.map(node => (
              <LessonNodeComponent
                key={node.id}
                node={node}
                onPress={() => handleNodePress(node)}
                colors={colors}
              />
            ))}
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.emptyContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {isLoading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : subjects.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📖</Text>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No subjects yet</Text>
              <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                Subjects will appear here once teachers publish them.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>👆</Text>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Pick a subject</Text>
              <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                Tap a subject pill above to start your path.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {error && (
        <TouchableOpacity style={styles.errorToast} onPress={clearError}>
          <Text style={styles.errorToastText}>{error}</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },

  // Header
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  greeting: { fontSize: FontSizes.xl, fontWeight: '800' },
  subGreeting: { fontSize: FontSizes.sm, marginTop: 2 },
  headerStats: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  xpCard: { marginTop: Spacing.sm, borderRadius: BorderRadius.lg, overflow: 'hidden' },

  // Subject pills
  subjectPills: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    gap: Spacing.sm,
    maxHeight: 45,
  },
  subjectPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
  },
  enrollPill: { backgroundColor: 'transparent', borderStyle: 'dashed' },
  subjectPillText: { fontSize: FontSizes.sm, fontWeight: '600' },

  // Path scroll
  pathScroll: { flex: 1 , marginTop: Spacing.lg },

  // Subject path header
  pathHeader: { alignItems: 'center', paddingVertical: Spacing.lg, paddingHorizontal: Spacing.xl },
  pathTitle: { fontSize: FontSizes.lg, fontWeight: '700', marginBottom: Spacing.sm, textAlign: 'center' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, width: '80%' },
  progressBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: '#34C759' },
  progressLabel: { fontSize: FontSizes.xs, fontWeight: '600', width: 32 },

  // Path canvas - holds absolutely-positioned nodes and lines
  pathCanvas: { position: 'relative' },

  // Node wrapper
  nodeWrapper: { position: 'absolute', alignItems: 'center' },
  lessonNode: {
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 5,
  },
  nodeIcon: { fontSize: 26 },
  checkBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFD700',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  checkMark: { fontSize: 11, fontWeight: '900', color: '#333' },
  nodeLabel: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
    maxWidth: NODE_SIZE + 40,
  },
  nodeLabelText: { fontSize: FontSizes.xs, fontWeight: '600', textAlign: 'center' },
  nodeXP: { fontSize: FontSizes.xs - 1, fontWeight: '700', textAlign: 'center', marginTop: 1 },

  // Empty state
  emptyContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 100 },
  emptyState: { alignItems: 'center', paddingTop: 40 },
  emptyEmoji: { fontSize: 64 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '600', marginTop: Spacing.md },
  emptyBody: {
    fontSize: FontSizes.sm,
    marginTop: Spacing.xs,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 20,
  },

  // Error toast
  errorToast: {
    position: 'absolute',
    bottom: 100,
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: '#FF3B30',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  errorToastText: { color: '#FFF', textAlign: 'center', fontWeight: '600' },
});
