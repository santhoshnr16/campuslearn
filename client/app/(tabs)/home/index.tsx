import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
  StatusBar,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { GlassCard } from '@/components/ui/glass-card';
import { NativeButton } from '@/components/ui/native-button';
import { Colors, Spacing, BorderRadius, FontSizes, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/stores/authStore';
import { subjectsService } from '@/services/subjects';
import { vettingService, VettingStats } from '@/services/vetting';
import { API_BASE_URL } from '@/services/api';

interface DashboardStats {
  subjectsCount: number;
  approvalRate: number;
}

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useAuthStore();

  const getAvatarUrl = () => {
    if (!user?.avatar_url) return null;
    if (user.avatar_url.startsWith('/')) {
      const serverBase = API_BASE_URL.replace('/api/v1', '');
      return serverBase + user.avatar_url;
    }
    return user.avatar_url;
  };

  const [stats, setStats] = useState<DashboardStats>({ subjectsCount: 0, approvalRate: 0 });
  const [vettingStats, setVettingStats] = useState<VettingStats | null>(null);
  const [pendingEnrollments, setPendingEnrollments] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [subjectsResponse, vettingResponse, enrollmentsData] = await Promise.all([
        subjectsService.listSubjects(1, 100),
        vettingService.getVettingStats(),
        subjectsService.getAllEnrollments('pending').catch(() => []),
      ]);

      setStats({
        subjectsCount: subjectsResponse.pagination.total,
        approvalRate: vettingResponse.approval_rate,
      });
      setVettingStats(vettingResponse);
      setPendingEnrollments(enrollmentsData.length);
    } catch (error: any) {
      console.error('Failed to load dashboard data:', error);
      setError(error?.message || 'Failed to load dashboard data');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

  const menuItems = [
    {
      title: 'Subjects',
      subtitle: 'Manage your subjects',
      icon: 'books.vertical.fill',
      gradient: colors.gradientBlue as [string, string],
      route: '/(tabs)/home/subjects',
    },
    {
      title: 'Generate',
      subtitle: 'Questions from rubrics',
      icon: 'sparkles',
      gradient: colors.gradientPurple as [string, string],
      route: '/(tabs)/home/generate',
    },
    {
      title: 'Vetting',
      subtitle: 'Review questions',
      icon: 'checkmark.shield.fill',
      gradient: colors.gradientGreen as [string, string],
      route: '/(tabs)/home/vetting',
    },
    {
      title: 'Reports',
      subtitle: 'View analytics',
      icon: 'chart.bar.fill',
      gradient: colors.gradientOrange as [string, string],
      route: '/(tabs)/home/reports',
    },
  ];

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <IconSymbol name="exclamationmark.triangle.fill" size={48} color={colors.error} />
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        <NativeButton
          title="Retry"
          onPress={loadData}
          variant="primary"
        />
      </View>
    );
  }

  const avatarUrl = getAvatarUrl();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Greeting Section with Profile Button */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.greetingContainer}>
            <Text style={[styles.greeting, { color: colors.textSecondary }]}>
              Welcome back,
            </Text>
            <Text style={[styles.userName, { color: colors.text }]}>
              {user?.full_name || user?.username || 'Professor'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/home/profile')}
            style={[styles.profileButton, { backgroundColor: avatarUrl ? 'transparent' : colors.primary + '15' }]}
            activeOpacity={0.8}
          >
            {avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                style={styles.profileImage}
              />
            ) : (
              <IconSymbol name="person.circle.fill" size={32} color={colors.primary} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats Cards - iOS 26 Glass Style */}
      <View style={styles.statsContainer}>
        <View style={styles.statCardWrapper}>
          <GlassCard style={styles.statCard}>
            <LinearGradient
              colors={colors.gradientBlue as [string, string]}
              style={styles.statIconContainer}
            >
              <IconSymbol name="books.vertical.fill" size={22} color="#FFFFFF" />
            </LinearGradient>
            <Text style={[styles.statValue, { color: colors.text }]}>{stats.subjectsCount}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Subjects</Text>
          </GlassCard>
        </View>

        <TouchableOpacity
          style={styles.statCardWrapper}
          onPress={() => router.push('/(tabs)/home/enrollments')}
          activeOpacity={0.7}
        >
          <GlassCard style={styles.statCard}>
            <LinearGradient
              colors={colors.gradientOrange as [string, string]}
              style={styles.statIconContainer}
            >
              <IconSymbol name="person.2.fill" size={22} color="#FFFFFF" />
            </LinearGradient>
            <Text style={[styles.statValue, { color: colors.text }]}>{pendingEnrollments}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Pending Enrollments</Text>
          </GlassCard>
        </TouchableOpacity>
      </View>

      {/* Navigation Section */}
      <Text style={[styles.sectionHeader, { color: colors.text }]}>Quick Actions</Text>

      {/* Menu Items - iOS 26 Grid Style */}
      <View style={styles.menuGrid}>
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={styles.menuGridItem}
            onPress={() => {
              console.log('[Home] Quick action pressed, route=', item.route);
              // Use router.push with absolute path for nested stack navigation
              router.push(item.route as never);
            }}
            activeOpacity={0.7}
          >
            <GlassCard style={styles.menuGridCard}>
              <View style={[styles.menuGridIconBg, { backgroundColor: item.gradient[0] + '20' }]}>
                <IconSymbol
                  name={item.icon as any}
                  size={28}
                  color={item.gradient[0]}
                  weight="semibold"
                />
              </View>
              <Text style={[styles.menuGridTitle, { color: colors.text }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[styles.menuGridSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {item.subtitle}
              </Text>
            </GlassCard>
          </TouchableOpacity>
        ))}
      </View>

      {/* Quick Overview */}
      {vettingStats && (
        <GlassCard style={styles.overviewCard}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Overview</Text>
          <View style={styles.overviewGrid}>
            <View style={styles.overviewItem}>
              <View style={[styles.overviewIconBg, { backgroundColor: colors.primary + '20' }]}>
                <IconSymbol name="doc.text.fill" size={20} color={colors.primary} />
              </View>
              <Text style={[styles.overviewValue, { color: colors.text }]}>
                {vettingStats.total_generated}
              </Text>
              <Text style={[styles.overviewLabel, { color: colors.textSecondary }]}>
                Generated
              </Text>
            </View>
            <View style={styles.overviewItem}>
              <View style={[styles.overviewIconBg, { backgroundColor: colors.success + '20' }]}>
                <IconSymbol name="checkmark.circle.fill" size={20} color={colors.success} />
              </View>
              <Text style={[styles.overviewValue, { color: colors.text }]}>
                {vettingStats.total_approved}
              </Text>
              <Text style={[styles.overviewLabel, { color: colors.textSecondary }]}>
                Approved
              </Text>
            </View>
            <View style={styles.overviewItem}>
              <View style={[styles.overviewIconBg, { backgroundColor: colors.warning + '20' }]}>
                <IconSymbol name="clock.fill" size={20} color={colors.warning} />
              </View>
              <Text style={[styles.overviewValue, { color: colors.text }]}>
                {vettingStats.pending_review}
              </Text>
              <Text style={[styles.overviewLabel, { color: colors.textSecondary }]}>
                Pending
              </Text>
            </View>
          </View>
        </GlassCard>
      )}



      {/* Bottom padding for native tab bar */}
      <View style={{ height: Platform.OS === 'ios' ? 100 : 80 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: Spacing.xxl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // iOS 26 Glass Card styles
  glassCardContainer: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    ...Shadows.medium,
  },
  glassCard: {
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
  },
  // Header
  header: {
    paddingTop: Platform.OS === 'ios' ? Spacing.xxxl + 20 : (Spacing.xl + (StatusBar.currentHeight ?? 24)),
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greetingContainer: {
    flex: 1,
  },
  profileButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  profileImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  greeting: {
    fontSize: FontSizes.md,
    fontWeight: '500',
  },
  userName: {
    fontSize: FontSizes.xxxl,
    fontWeight: '700',
    marginTop: Spacing.xs,
  },
  // Stats
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  statCardWrapper: {
    flex: 1,
  },
  statCard: {
    alignItems: 'center',
    marginHorizontal: 0,
    marginTop: 0,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
  },
  statIconContainer: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  statValue: {
    fontSize: FontSizes.xxl,
    fontWeight: '700',
    marginTop: Spacing.xs,
  },
  statLabel: {
    fontSize: FontSizes.xs,
    fontWeight: '500',
    marginTop: 2,
  },
  // Overview section
  overviewCard: {
    marginTop: Spacing.lg,
    marginHorizontal: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  overviewGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  overviewItem: {
    alignItems: 'center',
    flex: 1,
  },
  overviewIconBg: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overviewValue: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
    marginTop: Spacing.sm,
  },
  overviewLabel: {
    fontSize: FontSizes.xs,
    marginTop: Spacing.xs,
  },
  // Section header
  sectionHeader: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
    marginTop: Spacing.xxl,
    marginBottom: Spacing.md,
    marginHorizontal: Spacing.lg,
  },
  // Menu Grid - iOS 26 Style
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.lg,
    justifyContent: 'space-between',
  },
  menuGridItem: {
    width: '48%',
    marginBottom: Spacing.md,
  },
  menuGridCard: {
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 0,
    marginTop: 0,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.sm,
    height: 130,
  },
  menuGridIconBg: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuGridTitle: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  menuGridSubtitle: {
    fontSize: FontSizes.xs,
    textAlign: 'center',
    marginTop: 2,
    opacity: 0.8,
  },
  // Error/Retry
  errorText: {
    fontSize: FontSizes.md,
    textAlign: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
  retryButton: {
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
});
