/**
 * Student Profile Screen - shows gamification stats, badges, activity
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import { useLearningStore } from '@/stores/learningStore';
import { useAuthStore } from '@/stores/authStore';
import { XPBar, StreakCounter, HeartsDisplay } from '@/components/gamification';

export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const [refreshing, setRefreshing] = useState(false);

  const { user, logout } = useAuthStore();
  const { profile, testHistory, dailyActivity, isLoading, loadProfile, loadTestHistory, loadDailyActivity } =
    useLearningStore();

  const loadData = useCallback(async () => {
    await Promise.all([loadProfile(), loadTestHistory(), loadDailyActivity(7)]);
  }, [loadProfile, loadTestHistory, loadDailyActivity]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const getBadgeLabel = (badge: string) => {
    const labels: Record<string, string> = {
      streak_bronze: '🥉 7-Day Streak',
      streak_silver: '🥈 30-Day Streak',
      streak_gold: '🥇 100-Day Streak',
    };
    return labels[badge] || badge;
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <LinearGradient
            colors={['#007AFF', '#5856D6']}
            style={styles.avatarGradient}
          >
            <Text style={styles.avatarText}>
              {(user?.full_name || user?.username || '?')[0].toUpperCase()}
            </Text>
          </LinearGradient>
          <Text style={[styles.name, { color: colors.text }]}>
            {user?.full_name || user?.username}
          </Text>
          <Text style={[styles.email, { color: colors.textSecondary }]}>
            {user?.email}
          </Text>
        </View>

        {/* XP and Level */}
        {profile && (
          <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <XPBar xpTotal={profile.xp_total} level={profile.current_level} />
          </View>
        )}

        {/* Streak & Hearts Row */}
        {profile && (
          <View style={styles.gamificationRow}>
            <View style={[styles.gamificationCard, { backgroundColor: colors.backgroundSecondary }]}>
              <StreakCounter streak={profile.streak_count} />
            </View>
            <View style={[styles.gamificationCard, { backgroundColor: colors.backgroundSecondary }]}>
              <View style={{ alignItems: 'center', padding: Spacing.md }}>
                <HeartsDisplay hearts={profile.hearts} />
                <Text style={[styles.heartsLabel, { color: colors.textSecondary }]}>
                  Lives
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Stats */}
        {profile && (
          <View style={[styles.statsCard, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.statsTitle, { color: colors.text }]}>📊 Statistics</Text>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {profile.subjects_enrolled}
                </Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                  Subjects
                </Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {profile.total_lessons_completed}
                </Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                  Lessons
                </Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {profile.total_questions_answered}
                </Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                  Questions
                </Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {Math.round(profile.overall_accuracy)}%
                </Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                  Accuracy
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Badges */}
        {profile && profile.badges.length > 0 && (
          <View style={[styles.badgesCard, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.statsTitle, { color: colors.text }]}>🏅 Badges</Text>
            <View style={styles.badgesList}>
              {profile.badges.map((badge) => (
                <View key={badge} style={[styles.badge, { backgroundColor: colors.glassTertiary }]}>
                  <Text style={[styles.badgeText, { color: colors.text }]}>
                    {getBadgeLabel(badge)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Recent Activity */}
        {dailyActivity.length > 0 && (
          <View style={[styles.activityCard, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.statsTitle, { color: colors.text }]}>📅 This Week</Text>
            {dailyActivity.slice(0, 7).map((day) => (
              <View key={day.id} style={styles.activityRow}>
                <Text style={[styles.activityDate, { color: colors.textSecondary }]}>
                  {new Date(day.activity_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </Text>
                <Text style={[styles.activityXP, { color: '#007AFF' }]}>
                  +{day.xp_earned} XP
                </Text>
                <Text style={[styles.activityQuestions, { color: colors.textSecondary }]}>
                  {day.questions_answered} Q · {day.lessons_completed} lessons
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Recent Tests */}
        {testHistory.length > 0 && (
          <View style={[styles.historyCard, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.statsTitle, { color: colors.text }]}>📝 Recent Tests</Text>
            {testHistory.slice(0, 5).map((test) => (
              <View key={test.id} style={styles.testRow}>
                <View style={styles.testInfo}>
                  <Text style={[styles.testScore, { color: colors.text }]}>
                    {test.correct_answers}/{test.total_questions}
                  </Text>
                  <Text style={[styles.testMeta, { color: colors.textSecondary }]}>
                    {test.difficulty} · +{test.xp_earned} XP
                  </Text>
                </View>
                <Text style={[styles.testDate, { color: colors.textSecondary }]}>
                  {new Date(test.created_at).toLocaleDateString()}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Logout */}
        <TouchableOpacity
          style={[styles.logoutButton, { backgroundColor: '#FF3B3015' }]}
          onPress={logout}
        >
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { 
    paddingTop: 100,
    paddingBottom: 100,
  },
  profileHeader: {
    alignItems: 'center',
    paddingTop: 150,
    paddingBottom: Spacing.lg,
    marginTop: Spacing.xl,
  },
  avatarGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: '#fff', fontSize: 32, fontWeight: '700' },
  name: { fontSize: FontSizes.xl, fontWeight: '700', marginTop: Spacing.md },
  email: { fontSize: FontSizes.sm, marginTop: 4 },
  card: {
    marginHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  gamificationRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  gamificationCard: {
    flex: 1,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  heartsLabel: { fontSize: FontSizes.xs, marginTop: Spacing.xs },
  statsCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
  },
  statsTitle: { fontSize: FontSizes.lg, fontWeight: '700', marginBottom: Spacing.md },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statItem: {
    width: '50%',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  statValue: { fontSize: FontSizes.xxl, fontWeight: '800' },
  statLabel: { fontSize: FontSizes.xs, marginTop: 2 },
  badgesCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
  },
  badgesList: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  badge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  badgeText: { fontSize: FontSizes.sm, fontWeight: '600' },
  activityCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    gap: Spacing.sm,
  },
  activityDate: { fontSize: FontSizes.sm, width: 90 },
  activityXP: { fontSize: FontSizes.sm, fontWeight: '600', width: 70 },
  activityQuestions: { fontSize: FontSizes.xs, flex: 1 },
  historyCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
  },
  testRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  testInfo: {},
  testScore: { fontSize: FontSizes.md, fontWeight: '600' },
  testMeta: { fontSize: FontSizes.xs, marginTop: 2 },
  testDate: { fontSize: FontSizes.xs },
  logoutButton: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
  },
  logoutText: { color: '#FF3B30', fontSize: FontSizes.md, fontWeight: '600' },
});
