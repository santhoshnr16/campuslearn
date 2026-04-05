/**
 * Subject Detail Screen - shows Materials (PDFs) + Practice (topics) + Leaderboard
 */
import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import { MasteryRing } from '@/components/gamification';
import { IconSymbol } from '@/components/ui/icon-symbol';
import learnService from '@/services/learn';
import type { LeaderboardEntry } from '@/services/learn';

interface TopicWithProgress {
  id: string;
  name: string;
  mastery: number;
  questionsAttempted: number;
  accuracy: number;
  difficulty: string;
  hasSyllabus?: boolean;
  syllabusContent?: string;
}

type TabKey = 'materials' | 'practice' | 'ranks';

export default function SubjectDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const params = useLocalSearchParams<{ subjectId: string; subjectName: string }>();

  const [activeTab, setActiveTab] = useState<TabKey>('materials');
  const [topics, setTopics] = useState<TopicWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Materials
  const [referenceBooks, setReferenceBooks] = useState<any[]>([]);
  const [templatePapers, setTemplatePapers] = useState<any[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(true);

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | undefined>();
  const [loadingRanks, setLoadingRanks] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [topicsResponse, progressData] = await Promise.all([
        learnService.getTopics(params.subjectId),
        learnService.getSubjectProgress(params.subjectId),
      ]);

      const progressMap = new Map(
        progressData.map((p) => [p.topic_id, p])
      );

      const merged: TopicWithProgress[] = topicsResponse.topics.map((t: any) => {
        const p = progressMap.get(t.id);
        return {
          id: t.id,
          name: t.name,
          mastery: p?.topic_mastery ?? 0,
          questionsAttempted: p?.questions_attempted ?? 0,
          accuracy: p?.accuracy_percentage ?? 0,
          difficulty: p?.current_difficulty ?? 'easy',
          hasSyllabus: t.has_syllabus,
          syllabusContent: t.syllabus_content,
        };
      });
      setTopics(merged);
    } catch (err) {
      console.warn('Failed to load subject detail:', err);
    } finally {
      setLoading(false);
    }
  }, [params.subjectId]);

  const loadMaterials = useCallback(async () => {
    setLoadingMaterials(true);
    try {
      const data = await learnService.getStudentReferences(params.subjectId);
      setReferenceBooks(data.reference_books || []);
      setTemplatePapers(data.template_papers || []);
    } catch {
      // Materials may not exist
    } finally {
      setLoadingMaterials(false);
    }
  }, [params.subjectId]);

  const loadLeaderboard = useCallback(async () => {
    setLoadingRanks(true);
    try {
      // Class-wise leaderboard - only students enrolled in this subject
      const data = await learnService.getLeaderboard(50, params.subjectId);
      setLeaderboard(data.entries);
      setMyRank(data.current_user_rank);
    } catch {
      // Leaderboard may not exist
    } finally {
      setLoadingRanks(false);
    }
  }, [params.subjectId]);

  useEffect(() => {
    loadData();
    loadMaterials();
  }, [loadData, loadMaterials]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadData(), loadMaterials()]);
    setRefreshing(false);
  }, [loadData, loadMaterials]);

  const handleStartTopic = (topicId: string) => {
    router.push({
      pathname: '/(tabs)/learn/lesson',
      params: { subjectId: params.subjectId, subjectName: params.subjectName, topicId },
    });
  };

  const handleStartAll = () => {
    router.push({
      pathname: '/(tabs)/learn/lesson',
      params: { subjectId: params.subjectId, subjectName: params.subjectName },
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (filename: string) => {
    if (filename.endsWith('.pdf')) return '📄';
    if (filename.endsWith('.xlsx') || filename.endsWith('.csv')) return '📊';
    if (filename.endsWith('.doc') || filename.endsWith('.docx')) return '📝';
    return '📎';
  };

  const allMaterials = [...referenceBooks, ...templatePapers];

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          title: params.subjectName,
          headerBackTitle: 'Subjects',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: 'transparent' },
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text, fontWeight: '600' },
        }}
      />
      <View style={[styles.safeArea, { backgroundColor: colors.background, paddingTop: 20}]}>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* ============ MATERIALS TAB ============ */}
          {activeTab === 'materials' && (
            <>
              {loadingMaterials && loading ? (
                <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 150 }} />
              ) : allMaterials.length === 0 && !topics.some(t => t.hasSyllabus) ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyEmoji}>📚</Text>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No Learning Materials Yet</Text>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    Your teacher hasn't uploaded any reference materials or learning content for this subject yet.
                  </Text>
                </View>
              ) : (
                <>
                  {/* Topic Learning Content - Teacher's Notes/Syllabus */}
                  {topics.some(t => t.hasSyllabus) && (
                    <>
                      <Text style={[styles.sectionTitle, { color: colors.textSecondary, paddingTop: 100 }]}>LEARNING CONTENT</Text>
                      {topics.filter(t => t.hasSyllabus).map((topic) => (
                        <TouchableOpacity
                          key={topic.id}
                          style={[styles.materialCard, { backgroundColor: colors.backgroundSecondary }]}
                          onPress={() => {
                            // Navigate to topic content view
                            router.push({
                              pathname: '/(tabs)/learn/topic-content',
                              params: {
                                subjectId: params.subjectId,
                                topicId: topic.id,
                                topicName: topic.name,
                              },
                            });
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.materialIcon}>📖</Text>
                          <View style={styles.materialInfo}>
                            <Text style={[styles.materialName, { color: colors.text }]} numberOfLines={2}>
                              {topic.name}
                            </Text>
                            <Text style={[styles.materialMeta, { color: colors.textSecondary }]}>
                              Teacher's notes · Tap to read
                            </Text>
                          </View>
                          <View style={[styles.statusDot, { backgroundColor: '#34C759' }]} />
                        </TouchableOpacity>
                      ))}
                    </>
                  )}

                  {referenceBooks.length > 0 && (
                    <>
                      <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: topics.some(t => t.hasSyllabus) ? Spacing.lg : 0 }]}>REFERENCE BOOKS</Text>
                      {referenceBooks.map((doc) => (
                        <TouchableOpacity
                          key={doc.id}
                          style={[styles.materialCard, { backgroundColor: colors.backgroundSecondary }]}
                          onPress={() => {
                            const url = `http://10.0.0.3:8000/api/v1/documents/${doc.id}/content`;
                            router.push({
                              pathname: '/(tabs)/learn/pdf-viewer',
                              params: {
                                url,
                                title: doc.filename
                              }
                            });
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.materialIcon}>{getFileIcon(doc.filename)}</Text>
                          <View style={styles.materialInfo}>
                            <Text style={[styles.materialName, { color: colors.text }]} numberOfLines={2}>
                              {doc.filename}
                            </Text>
                            <Text style={[styles.materialMeta, { color: colors.textSecondary }]}>
                              {formatFileSize(doc.file_size_bytes)} · Uploaded {new Date(doc.upload_timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </Text>
                          </View>
                          <View style={[styles.statusDot, {
                            backgroundColor: doc.processing_status === 'completed' ? '#34C759' : doc.processing_status === 'processing' ? '#FF9500' : '#FF3B30',
                          }]} />
                        </TouchableOpacity>
                      ))}
                    </>
                  )}

                  {templatePapers.length > 0 && (
                    <>
                      <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: Spacing.lg }]}>TEMPLATE PAPERS</Text>
                      {templatePapers.map((doc) => (
                        <TouchableOpacity
                          key={doc.id}
                          style={[styles.materialCard, { backgroundColor: colors.backgroundSecondary }]}
                          onPress={() => {
                            const url = `http://10.0.0.3:8000/api/v1/documents/${doc.id}/content`;
                            router.push({
                              pathname: '/(tabs)/learn/pdf-viewer',
                              params: {
                                url,
                                title: doc.filename
                              }
                            });
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.materialIcon}>{getFileIcon(doc.filename)}</Text>
                          <View style={styles.materialInfo}>
                            <Text style={[styles.materialName, { color: colors.text }]} numberOfLines={2}>
                              {doc.filename}
                            </Text>
                            <Text style={[styles.materialMeta, { color: colors.textSecondary }]}>
                              {formatFileSize(doc.file_size_bytes)}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* ============ PRACTICE TAB ============ */}
          {activeTab === 'practice' && (
            <>

              {loading ? (
                <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
              ) : topics.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyEmoji}>📝</Text>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    No topics available yet.
                  </Text>
                </View>
              ) : (
                topics.map((topic) => (
                    <View style={{ marginTop: topics.indexOf(topic) === 0 ? 100 : 0 }}>
                    <TouchableOpacity
                      key={topic.id}
                      style={[styles.topicCard, { backgroundColor: colors.backgroundSecondary }]}
                      onPress={() => handleStartTopic(topic.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.topicLeft}>
                      <MasteryRing mastery={topic.mastery} size={50} />
                      </View>
                      <View style={styles.topicInfo}>
                      <Text style={[styles.topicName, { color: colors.text }]}>{topic.name}</Text>
                      <Text style={[styles.topicMeta, { color: colors.textSecondary }]}>
                        {topic.questionsAttempted > 0
                        ? `${Math.round(topic.accuracy)}% accuracy · ${topic.questionsAttempted} attempted`
                        : 'Not started'}
                      </Text>
                      <View style={[styles.diffBadge, {
                        backgroundColor: topic.difficulty === 'hard' ? '#FF3B3020' : topic.difficulty === 'medium' ? '#FF950020' : '#34C75920',
                      }]}>
                        <Text style={[styles.diffText, {
                        color: topic.difficulty === 'hard' ? '#FF3B30' : topic.difficulty === 'medium' ? '#FF9500' : '#34C759',
                        }]}>
                        {topic.difficulty}
                        </Text>
                      </View>
                      </View>
                      <Text style={[styles.arrow, { color: colors.textSecondary }]}>›</Text>
                    </TouchableOpacity>
                    </View>
                ))
              )}

              <TouchableOpacity
                style={[styles.startAllButton, { backgroundColor: colors.primary }]}
                onPress={handleStartAll}
              >
                <Text style={styles.startAllText}>🎯 Start Mixed Lesson</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ============ RANKS TAB ============ */}
            {activeTab === 'ranks' && (
            <>
              <View style={{ marginTop: 100 }}>
              {myRank && (
                <View style={[styles.myRankCard, { backgroundColor: colors.primary }]}>
                <Text style={styles.myRankLabel}>Your Rank</Text>
                <Text style={styles.myRankValue}>#{myRank}</Text>
                </View>
              )}

              {loadingRanks ? (
                <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
              ) : leaderboard.length === 0 ? (
                <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>🏆</Text>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No leaderboard data yet. Start practicing to earn XP!
                </Text>
                </View>
              ) : (
                leaderboard.map((entry, idx) => (
                <View
                  key={entry.user_id}
                  style={[styles.rankRow, {
                  backgroundColor: idx < 3 ? (colorScheme === 'dark' ? 'rgba(255,215,0,0.08)' : 'rgba(255,215,0,0.12)') : colors.backgroundSecondary,
                  }]}
                >
                  <Text style={[styles.rankNum, {
                  color: idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : idx === 2 ? '#CD7F32' : colors.textSecondary,
                  }]}>
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${entry.rank}`}
                  </Text>
                  <View style={styles.rankInfo}>
                  <Text style={[styles.rankName, { color: colors.text }]}>
                    {entry.full_name || entry.username}
                  </Text>
                  <Text style={[styles.rankMeta, { color: colors.textSecondary }]}>
                    Level {entry.level} · {entry.xp_total} XP
                  </Text>
                  </View>
                  <View style={[styles.xpBadge, { backgroundColor: colors.primary + '20' }]}>
                  <Text style={[styles.xpText, { color: colors.primary }]}>{entry.xp_total} XP</Text>
                  </View>
                </View>
                ))
              )}
              </View>
            </>
            )}
        </ScrollView>
        
        {/* Tab Selector */}
        <View style={[styles.tabSelector, { backgroundColor: colors.card, marginBottom: 100}]}>
          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'materials' && { backgroundColor: colors.primary },
            ]}
            onPress={() => setActiveTab('materials')}
          >
            <IconSymbol
              name="book.fill"
              size={16}
              color={activeTab === 'materials' ? '#FFFFFF' : colors.textSecondary}
            />
            <Text style={[styles.tabButtonText, { color: activeTab === 'materials' ? '#FFFFFF' : colors.textSecondary }]}>Learn</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'practice' && { backgroundColor: colors.primary },
            ]}
            onPress={() => setActiveTab('practice')}
          >
            <IconSymbol
              name="pencil.and.outline"
              size={16}
              color={activeTab === 'practice' ? '#FFFFFF' : colors.textSecondary}
            />
            <Text style={[styles.tabButtonText, { color: activeTab === 'practice' ? '#FFFFFF' : colors.textSecondary }]}>Practice</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'ranks' && { backgroundColor: colors.primary },
            ]}
            onPress={() => {
              setActiveTab('ranks');
              if (leaderboard.length === 0) loadLeaderboard();
            }}
          >
            <IconSymbol
              name="rosette"
              size={16}
              color={activeTab === 'ranks' ? '#FFFFFF' : colors.textSecondary}
            />
            <Text style={[styles.tabButtonText, { color: activeTab === 'ranks' ? '#FFFFFF' : colors.textSecondary }]}>Ranks</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  headerRow: { display: 'none' }, // legacy, kept around just in case
  backBtn: { fontSize: FontSizes.md, fontWeight: '500' },
  title: { fontSize: FontSizes.md, fontWeight: '600', flex: 1, textAlign: 'center' },
  tabSelector: {
    flexDirection: 'row',
    marginHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    padding: 4,
    height: 50,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
  },
  tabButtonText: {
    fontWeight: '600',
    fontSize: FontSizes.sm,
  },
  content: { padding: Spacing.lg, paddingBottom: 100 },
  // Materials
  sectionTitle: { fontSize: FontSizes.xs, fontWeight: '700', letterSpacing: 0.8, marginBottom: Spacing.sm },
  materialCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
  materialIcon: { fontSize: 32, marginRight: Spacing.md },
  materialInfo: { flex: 1 },
  materialName: { fontSize: FontSizes.md, fontWeight: '600' },
  materialMeta: { fontSize: FontSizes.xs, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginLeft: Spacing.sm },
  // Practice
  startAllButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  startAllText: { color: '#fff', fontSize: FontSizes.md, fontWeight: '700' },
  topicCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
  topicLeft: { marginRight: Spacing.md },
  topicInfo: { flex: 1 },
  topicName: { fontSize: FontSizes.md, fontWeight: '600' },
  topicMeta: { fontSize: FontSizes.xs, marginTop: 2 },
  diffBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    marginTop: 4,
  },
  diffText: { fontSize: FontSizes.xs, fontWeight: '600', textTransform: 'capitalize' },
  arrow: { fontSize: 24, fontWeight: '300' },
  // Ranks
  myRankCard: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.lg,
  },
  myRankLabel: { color: 'rgba(255,255,255,0.7)', fontSize: FontSizes.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  myRankValue: { color: '#fff', fontSize: 36, fontWeight: '800', marginTop: 4 },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
  rankNum: { fontSize: FontSizes.lg, fontWeight: '800', width: 40, textAlign: 'center' },
  rankInfo: { flex: 1, marginLeft: Spacing.sm },
  rankName: { fontSize: FontSizes.md, fontWeight: '600' },
  rankMeta: { fontSize: FontSizes.xs, marginTop: 2 },
  xpBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.md },
  xpText: { fontSize: FontSizes.xs, fontWeight: '700' },
  // Empty
  empty: { alignItems: 'center', paddingTop: 350 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '700', marginTop: Spacing.md },
  emptyText: { fontSize: FontSizes.md, marginTop: Spacing.sm, textAlign: 'center', paddingHorizontal: 40 },
});
