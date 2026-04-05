/**
 * Create Test Screen - Full configuration flow
 * Select subject, generation type, difficulty levels, LO mappings, topics
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { GlassCard } from '@/components/ui/glass-card';
import { NativeButton } from '@/components/ui/native-button';
import { subjectsService, Subject, Topic } from '@/services/subjects';
import { testsService, DifficultyLevelConfig, TopicSelection } from '@/services/tests';
import Slider from '@react-native-community/slider';

type Step = 'basics' | 'generation_type' | 'difficulty' | 'topics' | 'review';

interface DifficultyState {
  easy: { enabled: boolean; count: string; lo_mapping: string[] };
  medium: { enabled: boolean; count: string; lo_mapping: string[] };
  hard: { enabled: boolean; count: string; lo_mapping: string[] };
}

export default function CreateTestScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Flow state
  const [step, setStep] = useState<Step>('basics');
  const [isCreating, setIsCreating] = useState(false);

  // Subjects & topics
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(true);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [generationType, setGenerationType] = useState<'subject_wise' | 'topic_wise' | 'multi_topic'>('subject_wise');
  const [durationMinutes, setDurationMinutes] = useState('');

  // Difficulty config
  const [difficulty, setDifficulty] = useState<DifficultyState>({
    easy: { enabled: true, count: '5', lo_mapping: [] },
    medium: { enabled: true, count: '3', lo_mapping: [] },
    hard: { enabled: true, count: '2', lo_mapping: [] },
  });

  // Topic selections
  const [selectedTopics, setSelectedTopics] = useState<
    { topic_id: string; topic_name: string; count: string }[]
  >([]);

  // Learning Outcomes from subject
  const [learningOutcomes, setLearningOutcomes] = useState<string[]>([]);

  useEffect(() => {
    loadSubjects();
  }, []);

  const loadSubjects = async () => {
    try {
      const response = await subjectsService.listSubjects(1, 100);
      setSubjects(response.subjects || []);
    } catch (error) {
      console.error('Failed to load subjects:', error);
    } finally {
      setLoadingSubjects(false);
    }
  };

  const handleSubjectSelect = async (subjectId: string) => {
    setSelectedSubjectId(subjectId);
    try {
      const detail = await subjectsService.getSubject(subjectId);
      setTopics(detail.topics || []);
      // Extract LO IDs from subject
      const los: string[] = [];
      if (detail.learning_outcomes) {
        const loData = detail.learning_outcomes;
        if (Array.isArray(loData)) {
          loData.forEach((lo: any) => los.push(lo.id || lo.name || `LO${los.length + 1}`));
        } else if (typeof loData === 'object') {
          Object.keys(loData).forEach((k) => los.push(k));
        }
      }
      setLearningOutcomes(los);
    } catch (error) {
      console.error('Failed to load subject details:', error);
    }
  };

  const toggleLO = (diffLevel: 'easy' | 'medium' | 'hard', lo: string) => {
    setDifficulty((prev) => {
      const current = prev[diffLevel].lo_mapping;
      const updated = current.includes(lo)
        ? current.filter((l) => l !== lo)
        : [...current, lo];
      return { ...prev, [diffLevel]: { ...prev[diffLevel], lo_mapping: updated } };
    });
  };

  const toggleTopic = (topicId: string, topicName: string) => {
    setSelectedTopics((prev) => {
      const exists = prev.find((t) => t.topic_id === topicId);
      if (exists) {
        return prev.filter((t) => t.topic_id !== topicId);
      }
      return [...prev, { topic_id: topicId, topic_name: topicName, count: '5' }];
    });
  };

  const updateTopicCount = (topicId: string, count: string) => {
    setSelectedTopics((prev) =>
      prev.map((t) => (t.topic_id === topicId ? { ...t, count } : t))
    );
  };

  // For topic-wise tests, compute how difficulties distribute across topic questions
  const getTopicDifficultyDistribution = () => {
    // Build difficulty pool from enabled levels
    const pool: ('easy' | 'medium' | 'hard')[] = [];
    (['easy', 'medium', 'hard'] as const).forEach((level) => {
      if (difficulty[level].enabled) {
        const count = parseInt(difficulty[level].count) || 1;
        for (let i = 0; i < count; i++) pool.push(level);
      }
    });
    if (pool.length === 0) pool.push('easy', 'medium', 'hard');

    // Distribute topic questions across the pool
    const totalQuestions = selectedTopics.reduce((sum, t) => sum + (parseInt(t.count) || 0), 0);
    const distribution = { easy: 0, medium: 0, hard: 0 };
    for (let i = 0; i < totalQuestions; i++) {
      const level = pool[i % pool.length];
      distribution[level]++;
    }
    return distribution;
  };

  const getTotalQuestions = () => {
    if (generationType === 'subject_wise') {
      let total = 0;
      (['easy', 'medium', 'hard'] as const).forEach((d) => {
        if (difficulty[d].enabled) total += parseInt(difficulty[d].count) || 0;
      });
      return total;
    } else {
      return selectedTopics.reduce((sum, t) => sum + (parseInt(t.count) || 0), 0);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 'basics':
        return title.trim() && selectedSubjectId;
      case 'generation_type':
        return true;
      case 'difficulty':
        return Object.values(difficulty).some((d) => d.enabled && parseInt(d.count) > 0);
      case 'topics':
        return generationType === 'subject_wise' || selectedTopics.length > 0;
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const nextStep = () => {
    const steps: Step[] =
      generationType === 'subject_wise'
        ? ['basics', 'generation_type', 'difficulty', 'review']
        : ['basics', 'generation_type', 'topics', 'difficulty', 'review'];
    const currentIdx = steps.indexOf(step);
    if (currentIdx < steps.length - 1) {
      setStep(steps[currentIdx + 1]);
    }
  };

  const prevStep = () => {
    const steps: Step[] =
      generationType === 'subject_wise'
        ? ['basics', 'generation_type', 'difficulty', 'review']
        : ['basics', 'generation_type', 'topics', 'difficulty', 'review'];
    const currentIdx = steps.indexOf(step);
    if (currentIdx > 0) {
      setStep(steps[currentIdx - 1]);
    }
  };

  const handleCreateAndGenerate = async () => {
    if (!selectedSubjectId || !title.trim()) return;

    setIsCreating(true);
    try {
      // Build difficulty config
      const diffConfig: Record<string, DifficultyLevelConfig> = {};
      (['easy', 'medium', 'hard'] as const).forEach((d) => {
        if (difficulty[d].enabled && parseInt(difficulty[d].count) > 0) {
          diffConfig[d] = {
            count: parseInt(difficulty[d].count),
            lo_mapping: difficulty[d].lo_mapping,
          };
        }
      });

      // Build topic config
      const topicConfig: TopicSelection[] | undefined =
        generationType !== 'subject_wise' && selectedTopics.length > 0
          ? selectedTopics.map((t) => ({
            topic_id: t.topic_id,
            count: parseInt(t.count) || 5,
            topic_name: t.topic_name,
          }))
          : undefined;

      // 1. Create the test
      const test = await testsService.createTest({
        title: title.trim(),
        description: description.trim() || undefined,
        instructions: instructions.trim() || undefined,
        subject_id: selectedSubjectId,
        generation_type: generationType,
        difficulty_config: Object.keys(diffConfig).length > 0 ? diffConfig : undefined,
        topic_config: topicConfig,
        duration_minutes: durationMinutes ? parseInt(durationMinutes) : undefined,
      });

      // 2. Generate questions via AI (this may take a while)
      const result = await testsService.generateQuestions(test.id);

      Alert.alert(
        'Test Created!',
        `${result.questions_added} questions generated via AI (${result.total_marks} marks total). You can review and edit before publishing.`,
        [
          {
            text: 'Review Test',
            onPress: () =>
              router.replace({
                pathname: '/(tabs)/tests/detail',
                params: { testId: test.id },
              }),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.detail || error?.message || 'Failed to create test');
    } finally {
      setIsCreating(false);
    }
  };

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId);

  // Render steps
  const renderBasicsStep = () => (
    <View style={styles.stepContent}>
      <Text style={[styles.stepTitle, { color: colors.text }]}>Test Details</Text>
      <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
        Enter basic information about your test
      </Text>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.text }]}>Title *</Text>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border },
          ]}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g., Mid-Term Exam - Unit 1-3"
          placeholderTextColor={colors.textTertiary}
        />
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.text }]}>Description</Text>
        <TextInput
          style={[
            styles.input,
            styles.textArea,
            { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border },
          ]}
          value={description}
          onChangeText={setDescription}
          placeholder="Brief description of the test..."
          placeholderTextColor={colors.textTertiary}
          multiline
          numberOfLines={3}
        />
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.text }]}>Instructions</Text>
        <TextInput
          style={[
            styles.input,
            styles.textArea,
            { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border },
          ]}
          value={instructions}
          onChangeText={setInstructions}
          placeholder="Instructions for students..."
          placeholderTextColor={colors.textTertiary}
          multiline
          numberOfLines={3}
        />
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.text }]}>Duration (minutes)</Text>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border },
          ]}
          value={durationMinutes}
          onChangeText={setDurationMinutes}
          placeholder="e.g., 60"
          placeholderTextColor={colors.textTertiary}
          keyboardType="numeric"
        />
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.text }]}>Subject *</Text>
        {loadingSubjects ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {subjects.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[
                    styles.subjectChip,
                    {
                      backgroundColor:
                        selectedSubjectId === s.id ? colors.primary : colors.backgroundSecondary,
                      borderColor: selectedSubjectId === s.id ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => handleSubjectSelect(s.id)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: selectedSubjectId === s.id ? '#FFFFFF' : colors.text },
                    ]}
                  >
                    {s.code} - {s.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </View>
  );

  const renderGenerationTypeStep = () => (
    <View style={styles.stepContent}>
      <Text style={[styles.stepTitle, { color: colors.text }]}>Generation Type</Text>
      <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
        Choose how questions should be selected
      </Text>

      {[
        {
          key: 'subject_wise' as const,
          title: 'Subject-wise',
          desc: 'Select questions from the entire subject based on difficulty levels',
          icon: 'books.vertical.fill',
        },
        {
          key: 'topic_wise' as const,
          title: 'Topic-wise',
          desc: 'Select questions from a specific topic with difficulty distribution',
          icon: 'list.bullet.rectangle.fill',
        },
        {
          key: 'multi_topic' as const,
          title: 'Multi-topic',
          desc: 'Select questions from multiple topics with individual question counts',
          icon: 'square.grid.2x2.fill',
        },
      ].map((type) => (
        <TouchableOpacity
          key={type.key}
          onPress={() => setGenerationType(type.key)}
        >
          <GlassCard
            style={[
              styles.typeCard,
              generationType === type.key && {
                borderColor: colors.primary,
                borderWidth: 2,
              },
            ]}
          >
            <View style={styles.typeCardContent}>
              <IconSymbol
                name={type.icon as any}
                size={28}
                color={generationType === type.key ? colors.primary : colors.textTertiary}
              />
              <View style={styles.typeCardText}>
                <Text style={[styles.typeTitle, { color: colors.text }]}>{type.title}</Text>
                <Text style={[styles.typeDesc, { color: colors.textSecondary }]}>
                  {type.desc}
                </Text>
              </View>
              {generationType === type.key && (
                <IconSymbol name="checkmark.circle.fill" size={24} color={colors.primary} />
              )}
            </View>
          </GlassCard>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderDifficultyStep = () => {
    const isTopicBased = generationType !== 'subject_wise';
    return (
      <View style={styles.stepContent}>
        <Text style={[styles.stepTitle, { color: colors.text }]}>Difficulty Configuration</Text>
        <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
          {isTopicBased
            ? 'Enable difficulty levels — questions will be distributed proportionally across your topic counts'
            : 'Set number of questions and LO mappings per difficulty level'}
        </Text>

        {(['easy', 'medium', 'hard'] as const).map((level) => (
          <GlassCard key={level} style={styles.difficultyCard}>
            <TouchableOpacity
              style={styles.diffHeader}
              onPress={() =>
                setDifficulty((prev) => ({
                  ...prev,
                  [level]: { ...prev[level], enabled: !prev[level].enabled },
                }))
              }
            >
              <View style={styles.diffHeaderLeft}>
                <IconSymbol
                  name={difficulty[level].enabled ? 'checkmark.square.fill' : 'square'}
                  size={22}
                  color={difficulty[level].enabled ? colors.primary : colors.textTertiary}
                />
                <Text style={[styles.diffTitle, { color: colors.text }]}>
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </Text>
              </View>
              <View
                style={[
                  styles.diffBadge,
                  {
                    backgroundColor:
                      level === 'easy'
                        ? colors.success + '20'
                        : level === 'medium'
                          ? colors.warning + '20'
                          : colors.error + '20',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.diffBadgeText,
                    {
                      color:
                        level === 'easy'
                          ? colors.success
                          : level === 'medium'
                            ? colors.warning
                            : colors.error,
                    },
                  ]}
                >
                  {level === 'easy' ? '1 mark' : level === 'medium' ? '2 marks' : '3 marks'}
                </Text>
              </View>
            </TouchableOpacity>

            {difficulty[level].enabled && (
              <View style={styles.diffBody}>
                <View style={styles.sliderRow}>
                  <View style={styles.sliderLabelRow}>
                    <Text style={[styles.countLabel, { color: colors.textSecondary }]}>
                      {isTopicBased ? 'Weight' : 'Questions'}
                    </Text>
                    <View style={[styles.sliderValueBadge, { backgroundColor: colors.primary + '20' }]}>
                      <Text style={[styles.sliderValueText, { color: colors.primary }]}>
                        {isTopicBased
                          ? `${difficulty[level].count || '1'} → ${getTopicDifficultyDistribution()[level]} questions`
                          : difficulty[level].count || '0'}
                      </Text>
                    </View>
                  </View>
                  <Slider
                    style={styles.slider}
                    minimumValue={isTopicBased ? 1 : 0}
                    maximumValue={isTopicBased ? 10 : 20}
                    step={1}
                    value={parseInt(difficulty[level].count) || (isTopicBased ? 1 : 0)}
                    onValueChange={(v: number) =>
                      setDifficulty((prev) => ({
                        ...prev,
                        [level]: { ...prev[level], count: String(Math.round(v)) },
                      }))
                    }
                    minimumTrackTintColor={colors.primary}
                    maximumTrackTintColor={colors.border}
                    thumbTintColor={colors.primary}
                  />
                </View>

                {learningOutcomes.length > 0 && (
                  <View style={styles.loSection}>
                    <Text style={[styles.loLabel, { color: colors.textSecondary }]}>
                      Learning Outcomes:
                    </Text>
                    <View style={styles.loChips}>
                      {learningOutcomes.map((lo) => (
                        <TouchableOpacity
                          key={lo}
                          style={[
                            styles.loChip,
                            {
                              backgroundColor: difficulty[level].lo_mapping.includes(lo)
                                ? colors.primary
                                : colors.backgroundSecondary,
                              borderColor: difficulty[level].lo_mapping.includes(lo)
                                ? colors.primary
                                : colors.border,
                            },
                          ]}
                          onPress={() => toggleLO(level, lo)}
                        >
                          <Text
                            style={[
                              styles.loChipText,
                              {
                                color: difficulty[level].lo_mapping.includes(lo)
                                  ? '#FFFFFF'
                                  : colors.text,
                              },
                            ]}
                          >
                            {lo}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}
          </GlassCard>
        ))}

        <View style={styles.totalBar}>
          <Text style={[styles.totalText, { color: colors.text }]}>
            Total Questions: {getTotalQuestions()}
          </Text>
        </View>
      </View>
    );
  };

  const renderTopicsStep = () => (
    <View style={styles.stepContent}>
      <Text style={[styles.stepTitle, { color: colors.text }]}>Select Topics</Text>
      <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
        Choose topics and set question counts for each
      </Text>

      {topics.length === 0 ? (
        <View style={styles.emptyTopics}>
          <IconSymbol name="exclamationmark.triangle.fill" size={32} color={colors.warning} />
          <Text style={[styles.emptyTopicsText, { color: colors.textSecondary }]}>
            No topics found for this subject. Add topics first.
          </Text>
        </View>
      ) : (
        topics.map((topic) => {
          const isSelected = selectedTopics.some((t) => t.topic_id === topic.id);
          const topicEntry = selectedTopics.find((t) => t.topic_id === topic.id);
          return (
            <GlassCard key={topic.id} style={styles.topicCard}>
              <TouchableOpacity
                style={styles.topicHeader}
                onPress={() => toggleTopic(topic.id, topic.name)}
              >
                <IconSymbol
                  name={isSelected ? 'checkmark.square.fill' : 'square'}
                  size={22}
                  color={isSelected ? colors.primary : colors.textTertiary}
                />
                <View style={styles.topicInfo}>
                  <Text style={[styles.topicName, { color: colors.text }]}>{topic.name}</Text>
                  <Text style={[styles.topicMeta, { color: colors.textTertiary }]}>
                    {topic.total_questions || 0} approved questions available
                  </Text>
                </View>
              </TouchableOpacity>
              {isSelected && (
                <View style={styles.sliderRow}>
                  <View style={styles.sliderLabelRow}>
                    <Text style={[styles.countLabel, { color: colors.textSecondary }]}>
                      Questions
                    </Text>
                    <View style={[styles.sliderValueBadge, { backgroundColor: colors.primary + '20' }]}>
                      <Text style={[styles.sliderValueText, { color: colors.primary }]}>
                        {topicEntry?.count || '5'}
                      </Text>
                    </View>
                  </View>
                  <Slider
                    style={styles.slider}
                    minimumValue={1}
                    maximumValue={20}
                    step={1}
                    value={parseInt(topicEntry?.count || '5')}
                    onValueChange={(v: number) => updateTopicCount(topic.id, String(Math.round(v)))}
                    minimumTrackTintColor={colors.primary}
                    maximumTrackTintColor={colors.border}
                    thumbTintColor={colors.primary}
                  />
                </View>
              )}
            </GlassCard>
          );
        })
      )}

      {selectedTopics.length > 0 && (
        <View style={styles.totalBar}>
          <Text style={[styles.totalText, { color: colors.text }]}>
            Total Questions: {getTotalQuestions()}
          </Text>
        </View>
      )}
    </View>
  );

  const renderReviewStep = () => (
    <View style={styles.stepContent}>
      <Text style={[styles.stepTitle, { color: colors.text }]}>Review & Generate</Text>
      <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
        Review your test configuration before generating
      </Text>

      <GlassCard style={styles.reviewCard}>
        <View style={styles.reviewRow}>
          <Text style={[styles.reviewLabel, { color: colors.textSecondary }]}>Title</Text>
          <Text style={[styles.reviewValue, { color: colors.text }]}>{title}</Text>
        </View>
        <View style={styles.reviewRow}>
          <Text style={[styles.reviewLabel, { color: colors.textSecondary }]}>Subject</Text>
          <Text style={[styles.reviewValue, { color: colors.text }]}>
            {selectedSubject?.code} - {selectedSubject?.name}
          </Text>
        </View>
        <View style={styles.reviewRow}>
          <Text style={[styles.reviewLabel, { color: colors.textSecondary }]}>Type</Text>
          <Text style={[styles.reviewValue, { color: colors.text }]}>
            {generationType.replace('_', ' ')}
          </Text>
        </View>
        {durationMinutes && (
          <View style={styles.reviewRow}>
            <Text style={[styles.reviewLabel, { color: colors.textSecondary }]}>Duration</Text>
            <Text style={[styles.reviewValue, { color: colors.text }]}>
              {durationMinutes} minutes
            </Text>
          </View>
        )}

        {generationType === 'subject_wise' && (
          <>
            <View style={styles.reviewDivider} />

            <Text style={[styles.reviewSectionTitle, { color: colors.text }]}>Difficulty Distribution</Text>
            {(['easy', 'medium', 'hard'] as const).map(
              (level) =>
                difficulty[level].enabled &&
                parseInt(difficulty[level].count) > 0 && (
                  <View key={level} style={styles.reviewRow}>
                    <Text style={[styles.reviewLabel, { color: colors.textSecondary }]}>
                      {level.charAt(0).toUpperCase() + level.slice(1)}
                    </Text>
                    <Text style={[styles.reviewValue, { color: colors.text }]}>
                      {difficulty[level].count} questions
                      {difficulty[level].lo_mapping.length > 0
                        ? ` (${difficulty[level].lo_mapping.join(', ')})`
                        : ''}
                    </Text>
                  </View>
                )
            )}
          </>
        )}

        {generationType !== 'subject_wise' && selectedTopics.length > 0 && (
          <>
            <View style={styles.reviewDivider} />
            <Text style={[styles.reviewSectionTitle, { color: colors.text }]}>Topics</Text>
            {selectedTopics.map((t) => (
              <View key={t.topic_id} style={styles.reviewRow}>
                <Text style={[styles.reviewLabel, { color: colors.textSecondary }]}>
                  {t.topic_name}
                </Text>
                <Text style={[styles.reviewValue, { color: colors.text }]}>
                  {t.count} questions
                </Text>
              </View>
            ))}

            <View style={styles.reviewDivider} />
            <Text style={[styles.reviewSectionTitle, { color: colors.text }]}>Difficulty Distribution</Text>
            {(() => {
              const dist = getTopicDifficultyDistribution();
              return (['easy', 'medium', 'hard'] as const).map(
                (level) =>
                  dist[level] > 0 && (
                    <View key={level} style={styles.reviewRow}>
                      <Text style={[styles.reviewLabel, { color: colors.textSecondary }]}>
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                      </Text>
                      <Text style={[styles.reviewValue, { color: colors.text }]}>
                        {dist[level]} questions
                      </Text>
                    </View>
                  )
              );
            })()}
          </>
        )}

        <View style={styles.reviewDivider} />
        <View style={styles.reviewRow}>
          <Text style={[styles.reviewLabel, { color: colors.primary, fontWeight: '600' }]}>
            Total Questions
          </Text>
          <Text style={[styles.reviewValue, { color: colors.primary, fontWeight: '700' }]}>
            {getTotalQuestions()}
          </Text>
        </View>
      </GlassCard>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Progress */}
          <View style={styles.progressContainer}>
          {(['basics', 'generation_type', ...(generationType !== 'subject_wise' ? ['topics'] : []), 'difficulty', 'review'] as Step[]).map(
            (s, idx, arr) => (
              <View key={s} style={styles.progressItem}>
                <View
                  style={[
                    styles.progressDot,
                    {
                      backgroundColor:
                        arr.indexOf(step) >= idx ? colors.primary : colors.border,
                    },
                  ]}
                />
                {idx < arr.length - 1 && (
                  <View
                    style={[
                      styles.progressLine,
                      {
                        backgroundColor:
                          arr.indexOf(step) > idx ? colors.primary : colors.border,
                      },
                    ]}
                  />
                )}
              </View>
            )
          )}
        </View>

        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]} keyboardShouldPersistTaps="handled">
          {step === 'basics' && renderBasicsStep()}
          {step === 'generation_type' && renderGenerationTypeStep()}
          {step === 'difficulty' && renderDifficultyStep()}
          {step === 'topics' && renderTopicsStep()}
          {step === 'review' && renderReviewStep()}
        </ScrollView>

        {/* Bottom Actions */}
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.md + 60 }]}>
          {step !== 'basics' && (
            <NativeButton
              title="Back"
              variant="secondary"
              size="medium"
              icon="chevron.left"
              iconPosition="left"
              onPress={prevStep}
            />
          )}
          <View style={styles.flex} />
          {step === 'review' ? (
            <NativeButton
              title="Generate Test"
              variant="primary"
              size="medium"
              icon="sparkles"
              iconPosition="left"
              onPress={handleCreateAndGenerate}
              loading={isCreating}
              disabled={isCreating}
            />
          ) : (
            <NativeButton
              title="Next"
              variant="primary"
              size="medium"
              icon="chevron.right"
              iconPosition="right"
              onPress={nextStep}
              disabled={!canProceed()}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: 120,
    paddingBottom: Spacing.sm,
  },
  progressItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  progressLine: {
    width: 40,
    height: 2,
    marginHorizontal: 2,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: 120,
  },
  stepContent: {
    gap: Spacing.lg,
  },
  stepTitle: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
  },
  stepDescription: {
    fontSize: FontSizes.sm,
    marginBottom: Spacing.sm,
  },
  field: {
    gap: Spacing.sm,
  },
  label: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSizes.md,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: 4,
  },
  subjectChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  chipText: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  typeCard: {
    padding: Spacing.md,
  },
  typeCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  typeCardText: {
    flex: 1,
  },
  typeTitle: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  typeDesc: {
    fontSize: FontSizes.sm,
    marginTop: 2,
  },
  difficultyCard: {
    padding: Spacing.md,
  },
  diffHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  diffHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  diffTitle: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  diffBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  diffBadgeText: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
  },
  diffBody: {
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  countLabel: {
    fontSize: FontSizes.sm,
  },
  countInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    width: 60,
    textAlign: 'center',
    fontSize: FontSizes.md,
  },
  sliderRow: {
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  sliderValueBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    minWidth: 32,
    alignItems: 'center',
  },
  sliderValueText: {
    fontSize: FontSizes.md,
    fontWeight: '700' as const,
  },
  slider: {
    width: '100%',
    height: 36,
  },
  loSection: {
    gap: 6,
  },
  loLabel: {
    fontSize: FontSizes.sm,
  },
  loChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  loChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  loChipText: {
    fontSize: FontSizes.xs,
    fontWeight: '500',
  },
  totalBar: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  totalText: {
    fontSize: FontSizes.md,
    fontWeight: '700',
  },
  topicCard: {
    padding: Spacing.md,
  },
  topicHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  topicInfo: {
    flex: 1,
  },
  topicName: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  topicMeta: {
    fontSize: FontSizes.xs,
    marginTop: 2,
  },
  topicCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    marginLeft: 32,
  },
  emptyTopics: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: Spacing.sm,
  },
  emptyTopicsText: {
    fontSize: FontSizes.sm,
    textAlign: 'center',
  },
  reviewCard: {
    padding: Spacing.md,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  reviewLabel: {
    fontSize: FontSizes.sm,
    flex: 1,
  },
  reviewValue: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  reviewDivider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.08)',
    marginVertical: Spacing.sm,
  },
  reviewSectionTitle: {
    fontSize: FontSizes.sm,
    fontWeight: '700',
    marginBottom: 4,
  },
  generateNote: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
    alignItems: 'flex-start',
  },
  generateNoteText: {
    fontSize: FontSizes.xs,
    flex: 1,
    lineHeight: 18,
  },
  distributionPreview: {
    paddingVertical: Spacing.xs,
  },
  distributionText: {
    fontSize: FontSizes.sm,
    fontStyle: 'italic',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
});
