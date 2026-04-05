/**
 * Test Detail Screen - Role-aware: Teacher edit/publish, Student test info + Start
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
  Platform,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import { useAuthStore } from '@/stores/authStore';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { GlassCard } from '@/components/ui/glass-card';
import {
  testsService,
  TestDetailResponse,
  TestQuestion,
} from '@/services/tests';
import { subjectsService } from '@/services/subjects';

export default function TestDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { testId } = useLocalSearchParams<{ testId: string }>();
  const { user } = useAuthStore();
  const isStudent = user?.role === 'student';
  const insets = useSafeAreaInsets();

  // Calculate bottom padding for floating bar (accounts for tab bar + safe area)
  const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 49 : 60;
  const floatingBarBottom = TAB_BAR_HEIGHT + insets.bottom;

  const [test, setTest] = useState<TestDetailResponse | null>(null);
  const [studentTest, setStudentTest] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  // Teacher inline editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [editInstructions, setEditInstructions] = useState('');

  // Edit config modal
  const [showEditConfig, setShowEditConfig] = useState(false);
  const [cfgEasyCount, setCfgEasyCount] = useState('4');
  const [cfgMediumCount, setCfgMediumCount] = useState('3');
  const [cfgHardCount, setCfgHardCount] = useState('3');
  const [cfgEasyLO, setCfgEasyLO] = useState<string[]>([]);
  const [cfgMediumLO, setCfgMediumLO] = useState<string[]>([]);
  const [cfgHardLO, setCfgHardLO] = useState<string[]>([]);
  const [subjectLOs, setSubjectLOs] = useState<{ id: string; name: string }[]>([]);
  const [loadingSubjectLOs, setLoadingSubjectLOs] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const loadTest = useCallback(async () => {
    if (!testId) return;
    try {
      if (isStudent) {
        const data = await testsService.getStudentTest(testId);
        setStudentTest(data);
      } else {
        const data = await testsService.getTest(testId);
        setTest(data);
        setEditTitle(data.title);
        setEditDesc(data.description || '');
        setEditInstructions(data.instructions || '');
      }
    } catch (error: any) {
      console.error('Failed to load test:', error);
      Alert.alert('Error', error?.response?.data?.detail || 'Failed to load test');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [testId, isStudent]);

  useEffect(() => { loadTest(); }, [loadTest]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTest();
  }, [loadTest]);

  // Teacher handlers
  const handleSaveTitle = async () => {
    if (!testId || !editTitle.trim()) return;
    try {
      await testsService.updateTest(testId, { title: editTitle.trim() });
      setTest((p) => p ? { ...p, title: editTitle.trim() } : p);
      setEditingTitle(false);
    } catch { Alert.alert('Error', 'Failed to update title'); }
  };
  const handleSaveDesc = async () => {
    if (!testId) return;
    try {
      await testsService.updateTest(testId, { description: editDesc.trim() });
      setTest((p) => p ? { ...p, description: editDesc.trim() } : p);
      setEditingDesc(false);
    } catch { Alert.alert('Error', 'Failed to update description'); }
  };
  const handleSaveInstructions = async () => {
    if (!testId) return;
    try {
      await testsService.updateTest(testId, { instructions: editInstructions.trim() });
      setTest((p) => p ? { ...p, instructions: editInstructions.trim() } : p);
      setEditingInstructions(false);
    } catch { Alert.alert('Error', 'Failed to update instructions'); }
  };
  const handlePublish = async () => {
    if (!testId) return;
    Alert.alert('Publish Test', 'Make available to enrolled students?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Publish', onPress: async () => {
          setActionLoading('publish');
          try { await testsService.publishTest(testId); await loadTest(); }
          catch (e: any) { Alert.alert('Error', e?.response?.data?.detail || 'Failed'); }
          finally { setActionLoading(''); }
        }
      },
    ]);
  };
  const handleUnpublish = async () => {
    if (!testId) return;
    Alert.alert('Unpublish Test', 'Students will no longer see this test.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpublish', style: 'destructive', onPress: async () => {
          setActionLoading('unpublish');
          try { await testsService.unpublishTest(testId); await loadTest(); }
          catch (e: any) { Alert.alert('Error', e?.response?.data?.detail || 'Failed'); }
          finally { setActionLoading(''); }
        }
      },
    ]);
  };
  const handleRegenerate = async () => {
    if (!testId) return;
    Alert.alert('Regenerate Questions', 'Replace all questions with new ones?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Regenerate', onPress: async () => {
          setActionLoading('regenerate');
          try {
            const r = await testsService.generateQuestions(testId);
            Alert.alert('Done', `${r.questions_added} questions (${r.total_marks} marks)`);
            await loadTest();
          } catch (e: any) { Alert.alert('Error', e?.response?.data?.detail || 'Failed'); }
          finally { setActionLoading(''); }
        }
      },
    ]);
  };
  const handleRemoveQuestion = async (tqId: string) => {
    if (!testId) return;
    Alert.alert('Remove Question', 'Remove from test?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try { await testsService.removeTestQuestion(testId, tqId); await loadTest(); }
          catch { Alert.alert('Error', 'Failed to remove'); }
        }
      },
    ]);
  };

  const handleDeleteTest = () => {
    if (!testId) return;
    Alert.alert('Delete Test', 'This will permanently delete this test and all its questions. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setActionLoading('delete');
          try {
            await testsService.deleteTest(testId);
            router.back();
          } catch (e: any) {
            Alert.alert('Error', e?.response?.data?.detail || 'Failed to delete');
          } finally {
            setActionLoading('');
          }
        }
      },
    ]);
  };

  const handleOpenEditConfig = async () => {
    if (!test) return;
    const dc = (test as any).difficulty_config || {};
    setCfgEasyCount(String(dc.easy?.count || 4));
    setCfgMediumCount(String(dc.medium?.count || 3));
    setCfgHardCount(String(dc.hard?.count || 3));
    setCfgEasyLO(dc.easy?.lo_mapping || []);
    setCfgMediumLO(dc.medium?.lo_mapping || []);
    setCfgHardLO(dc.hard?.lo_mapping || []);
    setShowEditConfig(true);

    // Load subject LOs if not already loaded
    if (test.subject_id && subjectLOs.length === 0) {
      setLoadingSubjectLOs(true);
      try {
        const subjectDetail = await subjectsService.getSubject(test.subject_id);
        const los: { id: string; name: string }[] = [];
        if (subjectDetail.learning_outcomes?.outcomes) {
          subjectDetail.learning_outcomes.outcomes.forEach((lo: any) => {
            los.push({ id: lo.id, name: lo.name });
          });
        }
        setSubjectLOs(los);
      } catch (e) {
        console.error('Failed to load subject LOs:', e);
      } finally {
        setLoadingSubjectLOs(false);
      }
    }
  };

  const toggleLOMapping = (level: 'easy' | 'medium' | 'hard', loId: string) => {
    const setters = { easy: setCfgEasyLO, medium: setCfgMediumLO, hard: setCfgHardLO };
    const getters = { easy: cfgEasyLO, medium: cfgMediumLO, hard: cfgHardLO };
    const current = getters[level];
    if (current.includes(loId)) {
      setters[level](current.filter((id) => id !== loId));
    } else {
      setters[level]([...current, loId]);
    }
  };

  const handleSaveConfig = async () => {
    if (!testId) return;
    setIsSavingConfig(true);
    try {
      const easyCount = parseInt(cfgEasyCount) || 0;
      const mediumCount = parseInt(cfgMediumCount) || 0;
      const hardCount = parseInt(cfgHardCount) || 0;
      await testsService.updateTest(testId, {
        difficulty_config: {
          easy: { count: easyCount, lo_mapping: cfgEasyLO },
          medium: { count: mediumCount, lo_mapping: cfgMediumLO },
          hard: { count: hardCount, lo_mapping: cfgHardLO },
        },
      } as any);
      setShowEditConfig(false);
      await loadTest();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to save config');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const getDifficultyColor = (l?: string | null) => {
    switch (l) {
      case 'easy': return colors.success;
      case 'medium': return colors.warning;
      case 'hard': return colors.error;
      default: return colors.textTertiary;
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>
      </View>
    );
  }

  // ====== STUDENT VIEW ======
  if (isStudent) {
    if (!studentTest) {
      return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={styles.centered}>
            <IconSymbol name="exclamationmark.triangle.fill" size={48} color={colors.warning} />
            <Text style={{ color: colors.text, fontSize: FontSizes.lg, fontWeight: '600', marginTop: 12 }}>
              Test Not Available
            </Text>
            <Text style={{ color: colors.textSecondary, marginTop: 4, textAlign: 'center', paddingHorizontal: 40 }}>
              This test may have been unpublished or you may not be enrolled.
            </Text>
          </View>
        </View>
      );
    }

    const questions = studentTest.questions || [];
    const previousAttempt = studentTest.previous_attempt;
    
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingTop: 120, paddingBottom: 120 }}>
          {/* Hero Card */}
          <View style={{
            backgroundColor: colors.primary,
            borderRadius: BorderRadius.xl,
            padding: Spacing.xl,
            alignItems: 'center',
            marginBottom: Spacing.lg,
          }}>
            <Text style={{ fontSize: 48 }}>📝</Text>
            <Text style={{ color: '#FFF', fontSize: FontSizes.xxl, fontWeight: '800', marginTop: 12, textAlign: 'center' }}>
              {studentTest.title}
            </Text>
            {studentTest.description && (
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: FontSizes.sm, marginTop: 8, textAlign: 'center' }}>
                {studentTest.description}
              </Text>
            )}
          </View>

          {/* Previous Attempt Info */}
          {previousAttempt && (
            <GlassCard style={{ padding: Spacing.md, marginBottom: Spacing.lg, borderColor: colors.warning, borderWidth: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                <Text style={{ fontSize: 24 }}>🔄</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: FontSizes.sm, fontWeight: '600', color: colors.text }}>
                    Previous Attempt: {previousAttempt.score}/{previousAttempt.total_marks}
                  </Text>
                </View>
              </View>
            </GlassCard>
          )}

          {/* Test Stats */}
          <View style={{ flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg }}>
            <GlassCard style={{ flex: 1, alignItems: 'center', paddingVertical: Spacing.md }}>
              <Text style={{ fontSize: FontSizes.xxl, fontWeight: '800', color: colors.primary }}>{questions.length}</Text>
              <Text style={{ fontSize: FontSizes.xs, color: colors.textSecondary }}>Questions</Text>
            </GlassCard>
            <GlassCard style={{ flex: 1, alignItems: 'center', paddingVertical: Spacing.md }}>
              <Text style={{ fontSize: FontSizes.xxl, fontWeight: '800', color: colors.success }}>{studentTest.total_marks}</Text>
              <Text style={{ fontSize: FontSizes.xs, color: colors.textSecondary }}>Total Marks</Text>
            </GlassCard>
            {studentTest.duration_minutes && (
              <GlassCard style={{ flex: 1, alignItems: 'center', paddingVertical: Spacing.md }}>
                <Text style={{ fontSize: FontSizes.xxl, fontWeight: '800', color: colors.warning }}>{studentTest.duration_minutes}</Text>
                <Text style={{ fontSize: FontSizes.xs, color: colors.textSecondary }}>Minutes</Text>
              </GlassCard>
            )}
          </View>

          {/* Instructions */}
          {studentTest.instructions && (
            <GlassCard style={{ padding: Spacing.md, marginBottom: Spacing.lg }}>
              <Text style={{ fontSize: FontSizes.xs, fontWeight: '600', color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                📋 Instructions
              </Text>
              <Text style={{ fontSize: FontSizes.sm, color: colors.textSecondary, lineHeight: 20 }}>
                {studentTest.instructions}
              </Text>
            </GlassCard>
          )}

          {/* Tips */}
          <GlassCard style={{ padding: Spacing.md, marginBottom: Spacing.xl }}>
            <Text style={{ fontSize: FontSizes.sm, fontWeight: '600', color: colors.text, marginBottom: 8 }}>
              💡 Tips
            </Text>
            <Text style={{ fontSize: FontSizes.sm, color: colors.textSecondary, lineHeight: 20 }}>
              • Questions will appear one at a time{'\n'}
              • Tap an option to select your answer{'\n'}
              • You can navigate between questions{'\n'}
              • Submit when you're ready!
            </Text>
          </GlassCard>

          {/* Start Button */}
          <TouchableOpacity
            style={{
              backgroundColor: colors.primary,
              paddingVertical: 16,
              borderRadius: BorderRadius.xl,
              alignItems: 'center',
              shadowColor: colors.primary,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
            }}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/tests/take-test',
                params: { testId: studentTest.id },
              })
            }
          >
            <Text style={{ color: '#FFF', fontSize: FontSizes.lg, fontWeight: '800' }}>
              {previousAttempt ? '🔄 Retake Test' : '🚀 Start Test'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ====== TEACHER VIEW ======
  if (!test) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}><Text style={{ color: colors.error }}>Test not found</Text></View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: 110, paddingBottom: floatingBarBottom + 70 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Status Banner */}
        <View style={[styles.statusBanner, {
          backgroundColor: (test.status === 'published' ? colors.success : test.status === 'draft' ? colors.warning : colors.textTertiary) + '15',
          borderColor: (test.status === 'published' ? colors.success : test.status === 'draft' ? colors.warning : colors.textTertiary) + '30',
        }]}>
          <IconSymbol
            name={test.status === 'published' ? 'checkmark.circle.fill' : test.status === 'draft' ? 'pencil.circle.fill' : 'xmark.circle.fill'}
            size={20}
            color={test.status === 'published' ? colors.success : test.status === 'draft' ? colors.warning : colors.textTertiary}
          />
          <Text style={[styles.statusBannerText, {
            color: test.status === 'published' ? colors.success : test.status === 'draft' ? colors.warning : colors.textTertiary,
          }]}>
            {test.status === 'published' ? 'Published — students can take this test'
              : test.status === 'draft' ? 'Draft — not yet visible to students'
                : 'Unpublished — no longer visible'}
          </Text>
        </View>

        {/* Title */}
        <GlassCard style={styles.infoCard}>
          <View style={styles.editableRow}>
            {editingTitle ? (
              <View style={styles.editRow}>
                <TextInput style={[styles.editInput, { color: colors.text, borderColor: colors.border }]} value={editTitle} onChangeText={setEditTitle} autoFocus />
                <TouchableOpacity onPress={handleSaveTitle}><IconSymbol name="checkmark.circle.fill" size={28} color={colors.primary} /></TouchableOpacity>
                <TouchableOpacity onPress={() => { setEditingTitle(false); setEditTitle(test.title); }}><IconSymbol name="xmark.circle.fill" size={28} color={colors.textTertiary} /></TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.editTrigger} onPress={() => setEditingTitle(true)}>
                <Text style={[styles.testTitle, { color: colors.text }]}>{test.title}</Text>
                <IconSymbol name="pencil" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.editableRow}>
            {editingDesc ? (
              <View style={[styles.editRow, { flex: 1 }]}>
                <TextInput style={[styles.editInput, styles.multilineEdit, { color: colors.text, borderColor: colors.border }]} value={editDesc} onChangeText={setEditDesc} multiline autoFocus />
                <View style={styles.editActions}>
                  <TouchableOpacity onPress={handleSaveDesc}><IconSymbol name="checkmark.circle.fill" size={28} color={colors.primary} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => { setEditingDesc(false); setEditDesc(test.description || ''); }}><IconSymbol name="xmark.circle.fill" size={28} color={colors.textTertiary} /></TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.editTrigger} onPress={() => setEditingDesc(true)}>
                <Text style={[styles.descText, { color: colors.textSecondary }]}>{test.description || 'Add description...'}</Text>
                <IconSymbol name="pencil" size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.editableRow}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Instructions</Text>
            {editingInstructions ? (
              <View style={[styles.editRow, { flex: 1 }]}>
                <TextInput style={[styles.editInput, styles.multilineEdit, { color: colors.text, borderColor: colors.border }]} value={editInstructions} onChangeText={setEditInstructions} multiline autoFocus />
                <View style={styles.editActions}>
                  <TouchableOpacity onPress={handleSaveInstructions}><IconSymbol name="checkmark.circle.fill" size={28} color={colors.primary} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => { setEditingInstructions(false); setEditInstructions(test.instructions || ''); }}><IconSymbol name="xmark.circle.fill" size={28} color={colors.textTertiary} /></TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.editTrigger} onPress={() => setEditingInstructions(true)}>
                <Text style={[styles.descText, { color: colors.textSecondary }]}>{test.instructions || 'Add instructions...'}</Text>
                <IconSymbol name="pencil" size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{test.total_questions}</Text>
              <Text style={[styles.statLabel, { color: colors.textTertiary }]}>Questions</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{test.total_marks}</Text>
              <Text style={[styles.statLabel, { color: colors.textTertiary }]}>Marks</Text>
            </View>
            {test.duration_minutes && (
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.primary }]}>{test.duration_minutes}</Text>
                <Text style={[styles.statLabel, { color: colors.textTertiary }]}>Minutes</Text>
              </View>
            )}
            {test.submissions_count > 0 && (
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.success }]}>{test.submissions_count}</Text>
                <Text style={[styles.statLabel, { color: colors.textTertiary }]}>Submissions</Text>
              </View>
            )}
          </View>
        </GlassCard>

        {/* Questions */}
        <Text style={[styles.questionsHeader, { color: colors.text }]}>Questions ({test.questions?.length || 0})</Text>
        {(!test.questions || test.questions.length === 0) ? (
          <GlassCard style={styles.emptyQuestions}>
            <IconSymbol name="doc.text" size={32} color={colors.textTertiary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No questions yet. Use "Regenerate" to select questions.</Text>
          </GlassCard>
        ) : (
          test.questions.map((q: TestQuestion, idx: number) => (
            <GlassCard key={q.id} style={styles.questionCard}>
              <View style={styles.questionHeader}>
                <View style={styles.questionIndex}><Text style={[styles.indexText, { color: colors.primary }]}>Q{idx + 1}</Text></View>
                <View style={styles.questionBadges}>
                  <View style={[styles.diffBadge, { backgroundColor: getDifficultyColor(q.difficulty_level) + '20' }]}>
                    <Text style={[styles.diffBadgeText, { color: getDifficultyColor(q.difficulty_level) }]}>{q.difficulty_level || 'N/A'}</Text>
                  </View>
                  <Text style={[styles.marksText, { color: colors.textTertiary }]}>{q.marks} mark{q.marks !== 1 ? 's' : ''}</Text>
                </View>
              </View>
              <Text style={[styles.questionText, { color: colors.text }]} numberOfLines={3}>{q.question_text}</Text>
              {q.topic_name && <Text style={[styles.topicTag, { color: colors.textTertiary }]}>Topic: {q.topic_name}</Text>}
              {q.options && q.options.length > 0 && (
                <View style={styles.optionsList}>
                  {q.options.map((opt, i) => (
                    <Text key={i} style={[styles.optionText, {
                      color: q.correct_answer && opt.charAt(0).toUpperCase() === q.correct_answer.charAt(0).toUpperCase() ? colors.success : colors.textSecondary,
                    }]} numberOfLines={2}>{opt}</Text>
                  ))}
                </View>
              )}
              <View style={styles.questionActions}>
                <TouchableOpacity style={[styles.qAction, { borderColor: colors.border }]}
                  onPress={() => router.push({ pathname: '/(tabs)/tests/edit-question', params: { testId: test.id, testQuestionId: q.id, questionText: q.question_text, options: JSON.stringify(q.options || []), correctAnswer: q.correct_answer || '', marks: String(q.marks) } })}>
                  <IconSymbol name="pencil" size={14} color={colors.primary} /><Text style={[styles.qActionText, { color: colors.primary }]}>Edit</Text>
                </TouchableOpacity>
                {test.status !== 'published' && (
                  <TouchableOpacity style={[styles.qAction, { borderColor: colors.error + '40' }]} onPress={() => handleRemoveQuestion(q.id)}>
                    <IconSymbol name="trash" size={14} color={colors.error} /><Text style={[styles.qActionText, { color: colors.error }]}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            </GlassCard>
          ))
        )}
      </ScrollView>

      {/* ===== Floating Action Bar ===== */}
      <View style={[styles.floatingBar, { backgroundColor: 'transparent', borderTopWidth: 0, bottom: floatingBarBottom }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.floatingBarContent}>
          {test.status !== 'published' && (
            <TouchableOpacity style={[styles.fabButton, { backgroundColor: colors.success }]} onPress={handlePublish} disabled={!!actionLoading}>
              {actionLoading === 'publish' ? <ActivityIndicator size="small" color="#FFF" /> : (
                <><IconSymbol name="paperplane.fill" size={16} color="#FFF" /><Text style={styles.fabText}>Publish</Text></>
              )}
            </TouchableOpacity>
          )}
          {test.status === 'published' && (
            <TouchableOpacity style={[styles.fabButton, { backgroundColor: colors.error }]} onPress={handleUnpublish} disabled={!!actionLoading}>
              {actionLoading === 'unpublish' ? <ActivityIndicator size="small" color="#FFF" /> : (
                <><IconSymbol name="xmark.circle.fill" size={16} color="#FFF" /><Text style={styles.fabText}>Unpublish</Text></>
              )}
            </TouchableOpacity>
          )}
          {test.status !== 'published' && (
            <TouchableOpacity style={[styles.fabButton, { backgroundColor: colors.secondary }]} onPress={handleRegenerate} disabled={!!actionLoading}>
              {actionLoading === 'regenerate' ? <ActivityIndicator size="small" color="#FFF" /> : (
                <><IconSymbol name="arrow.triangle.2.circlepath" size={16} color="#FFF" /><Text style={styles.fabText}>Regen</Text></>
              )}
            </TouchableOpacity>
          )}
          {test.status !== 'published' && (
            <TouchableOpacity style={[styles.fabButton, { backgroundColor: colors.primary }]} onPress={handleOpenEditConfig}>
              <IconSymbol name="slider.horizontal.3" size={16} color="#FFF" /><Text style={styles.fabText}>Config</Text>
            </TouchableOpacity>
          )}
          {test.submissions_count > 0 && (
            <TouchableOpacity style={[styles.fabButton, { backgroundColor: colors.primary }]}
              onPress={() => router.push({ pathname: '/(tabs)/tests/performance', params: { testId: test.id } })}>
              <IconSymbol name="chart.bar.fill" size={16} color="#FFF" /><Text style={styles.fabText}>Stats</Text>
            </TouchableOpacity>
          )}
          {test.status !== 'published' && (
            <TouchableOpacity style={[styles.fabButton, { backgroundColor: '#FF3B30' }]} onPress={handleDeleteTest} disabled={!!actionLoading}>
              {actionLoading === 'delete' ? <ActivityIndicator size="small" color="#FFF" /> : (
                <><IconSymbol name="trash.fill" size={16} color="#FFF" /><Text style={styles.fabText}>Delete</Text></>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      {/* ===== Edit Config Modal ===== */}
      <Modal visible={showEditConfig} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowEditConfig(false)}>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
          <View style={styles.configModalHeader}>
            <TouchableOpacity onPress={() => setShowEditConfig(false)}>
              <Text style={{ fontSize: FontSizes.md, color: colors.primary }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.configModalTitle, { color: colors.text }]}>Question Config</Text>
            <TouchableOpacity onPress={handleSaveConfig} disabled={isSavingConfig}>
              {isSavingConfig ? <ActivityIndicator size="small" color={colors.primary} /> : (
                <Text style={{ fontSize: FontSizes.md, color: colors.primary, fontWeight: '600' }}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
          <ScrollView style={{ padding: Spacing.lg }}>
            <Text style={[styles.configSectionTitle, { color: colors.text }]}>Difficulty Distribution</Text>
            <Text style={{ fontSize: FontSizes.xs, color: colors.textSecondary, marginBottom: Spacing.md }}>
              Total: {(parseInt(cfgEasyCount) || 0) + (parseInt(cfgMediumCount) || 0) + (parseInt(cfgHardCount) || 0)} questions
            </Text>
            {[
              { label: 'Easy', value: cfgEasyCount, setter: setCfgEasyCount, color: '#34C759', loState: cfgEasyLO, level: 'easy' as const },
              { label: 'Medium', value: cfgMediumCount, setter: setCfgMediumCount, color: '#FF9500', loState: cfgMediumLO, level: 'medium' as const },
              { label: 'Hard', value: cfgHardCount, setter: setCfgHardCount, color: '#FF3B30', loState: cfgHardLO, level: 'hard' as const },
            ].map(({ label, value, setter, color, loState, level }) => (
              <View key={label} style={[styles.configRow, { flexDirection: 'column', alignItems: 'stretch' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={styles.configLabelRow}>
                    <View style={[styles.configDot, { backgroundColor: color }]} />
                    <Text style={[styles.configLabel, { color: colors.text }]}>{label}</Text>
                  </View>
                  <View style={styles.configCountRow}>
                    <TouchableOpacity style={[styles.configCountBtn, { borderColor: colors.border }]} onPress={() => setter(String(Math.max(0, (parseInt(value) || 0) - 1)))}>
                      <Text style={{ fontSize: 18, color: colors.primary, fontWeight: '700' }}>−</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={[styles.configInput, { color: colors.text, borderColor: colors.border }]}
                      value={value}
                      onChangeText={setter}
                      keyboardType="number-pad"
                      textAlign="center"
                    />
                    <TouchableOpacity style={[styles.configCountBtn, { borderColor: colors.border }]} onPress={() => setter(String((parseInt(value) || 0) + 1))}>
                      <Text style={{ fontSize: 18, color: colors.primary, fontWeight: '700' }}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {/* LO Mapping */}
                {subjectLOs.length > 0 && (
                  <View style={{ marginTop: Spacing.sm }}>
                    <Text style={{ fontSize: FontSizes.xs, color: colors.textSecondary, marginBottom: 4 }}>
                      LO Mapping (optional)
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {subjectLOs.map((lo) => (
                        <TouchableOpacity
                          key={lo.id}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: BorderRadius.full,
                            borderWidth: 1,
                            backgroundColor: loState.includes(lo.id) ? color + '20' : 'transparent',
                            borderColor: loState.includes(lo.id) ? color : colors.border,
                          }}
                          onPress={() => toggleLOMapping(level, lo.id)}
                        >
                          <Text style={{ fontSize: FontSizes.xs, fontWeight: '500', color: loState.includes(lo.id) ? color : colors.textSecondary }}>
                            {lo.id}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            ))}
            {loadingSubjectLOs && (
              <View style={{ alignItems: 'center', paddingVertical: Spacing.md }}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={{ fontSize: FontSizes.xs, color: colors.textSecondary, marginTop: 4 }}>Loading Learning Outcomes...</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: Spacing.md },
  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1, marginBottom: Spacing.md },
  statusBannerText: { fontSize: FontSizes.sm, fontWeight: '500', flex: 1 },
  infoCard: { padding: Spacing.md, marginBottom: Spacing.md, gap: Spacing.sm },
  editableRow: { gap: 4 },
  editTrigger: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  editInput: { borderWidth: 1, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.sm, paddingVertical: 8, fontSize: FontSizes.md, flex: 1 },
  multilineEdit: { minHeight: 60, textAlignVertical: 'top' },
  editActions: { gap: 4 },
  testTitle: { fontSize: FontSizes.xl, fontWeight: '700' },
  descText: { fontSize: FontSizes.sm, flex: 1 },
  sectionLabel: { fontSize: FontSizes.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  statsRow: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: FontSizes.lg, fontWeight: '700' },
  statLabel: { fontSize: FontSizes.xs, marginTop: 2 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: BorderRadius.md },
  actionText: { color: '#FFFFFF', fontSize: FontSizes.sm, fontWeight: '600' },
  questionsHeader: { fontSize: FontSizes.lg, fontWeight: '700', marginBottom: Spacing.sm },
  emptyQuestions: { alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyText: { fontSize: FontSizes.sm, textAlign: 'center' },
  questionCard: { padding: Spacing.md, marginBottom: Spacing.sm },
  questionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  questionIndex: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,122,255,0.1)' },
  indexText: { fontSize: FontSizes.sm, fontWeight: '700' },
  questionBadges: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  diffBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: BorderRadius.full },
  diffBadgeText: { fontSize: FontSizes.xs, fontWeight: '600', textTransform: 'capitalize' },
  marksText: { fontSize: FontSizes.xs },
  questionText: { fontSize: FontSizes.md, lineHeight: 22, marginBottom: 6 },
  topicTag: { fontSize: FontSizes.xs, marginBottom: 6 },
  optionsList: { gap: 4, marginBottom: 8 },
  optionText: { fontSize: FontSizes.sm, paddingLeft: 8 },
  questionActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  qAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: BorderRadius.md, borderWidth: 1 },
  qActionText: { fontSize: FontSizes.xs, fontWeight: '500' },
  // Floating action bar
  floatingBar: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, paddingVertical: 12 },
  floatingBarContent: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.md },
  fabButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 10, borderRadius: BorderRadius.lg },
  fabText: { color: '#FFFFFF', fontSize: FontSizes.xs, fontWeight: '600' },
  // Config modal
  configModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.08)' },
  configModalTitle: { fontSize: FontSizes.lg, fontWeight: '700' },
  configSectionTitle: { fontSize: FontSizes.md, fontWeight: '700', marginBottom: 4 },
  configRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  configLabelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  configDot: { width: 12, height: 12, borderRadius: 6 },
  configLabel: { fontSize: FontSizes.md, fontWeight: '500' },
  configCountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  configCountBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  configInput: { width: 48, height: 36, borderWidth: 1, borderRadius: BorderRadius.md, fontSize: FontSizes.md, fontWeight: '600' },
});
