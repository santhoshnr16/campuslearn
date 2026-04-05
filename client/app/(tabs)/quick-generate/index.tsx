import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Animated,
  Modal,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import Slider from '@react-native-community/slider';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { GlassCard } from '@/components/ui/glass-card';
import { Colors, Spacing, BorderRadius, FontSizes, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { questionsService, QuickGenerateProgress, Question } from '@/services/questions';
import { subjectsService, Subject, Topic } from '@/services/subjects';
import { useToast } from '@/components/toast';
import { extractErrorDetails } from '@/utils/errors';
import { selectionImpact, mediumImpact, lightImpact } from '@/utils/haptics';
import { QuestionSources } from '@/components/question-sources';

type QuestionType = 'mcq' | 'short_answer' | 'long_answer';
type Difficulty = 'easy' | 'medium' | 'hard';

export default function QuickGenerateScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const { showError, showSuccess, showWarning } = useToast();

  // Form state
  const [selectedFile, setSelectedFile] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [context, setContext] = useState('');
  const [count, setCount] = useState(10);
  const [customCount, setCustomCount] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>(['mcq']);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  // Marks per question type
  const [marksMcq, setMarksMcq] = useState(1);
  const [marksShort, setMarksShort] = useState(2);
  const [marksLong, setMarksLong] = useState(5);

  // Subject/Topic linking
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);
  const [showTopicPicker, setShowTopicPicker] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<QuickGenerateProgress | null>(null);
  const [generatedQuestions, setGeneratedQuestions] = useState<Question[]>([]);
  const cancelRef = useRef<(() => void) | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Track if document picker is currently open
  const [isPickingDocument, setIsPickingDocument] = useState(false);

  // Load subjects on mount
  useEffect(() => {
    loadSubjects();
  }, []);

  // Load topics when subject changes
  useEffect(() => {
    if (selectedSubjectId) {
      loadTopics(selectedSubjectId);
    } else {
      setTopics([]);
      setSelectedTopicId(null);
    }
  }, [selectedSubjectId]);

  const loadSubjects = async () => {
    setLoadingSubjects(true);
    try {
      const response = await subjectsService.listSubjects(1, 100);
      setSubjects(response.subjects);
    } catch (error) {
      const details = extractErrorDetails(error);
      if (details.isAuthError) {
        // Auth interceptor already redirected to login — suppress noisy log
        return;
      }
      console.error('Failed to load subjects:', error);
      showError(error, 'Failed to load subjects');
    } finally {
      setLoadingSubjects(false);
      setIsRefreshing(false);
    }
  };

  const loadTopics = async (subjectId: string) => {
    setLoadingTopics(true);
    try {
      const response = await subjectsService.listTopics(subjectId, 1, 100);
      setTopics(response.topics);
    } catch (error) {
      console.error('Failed to load topics:', error);
    } finally {
      setLoadingTopics(false);
    }
  };

  const getSelectedSubject = () => subjects.find(s => s.id === selectedSubjectId);
  const getSelectedTopic = () => topics.find(t => t.id === selectedTopicId);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadSubjects();
  };

  const handlePickDocument = async () => {
    if (isPickingDocument) {
      showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      return;
    }

    setIsPickingDocument(true);
    try {
      mediumImpact();
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets[0]) {
        setSelectedFile({
          uri: result.assets[0].uri,
          name: result.assets[0].name,
          type: result.assets[0].mimeType || 'application/pdf',
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('document picking in progress') || errorMessage.includes('Different document picking')) {
        showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      } else {
        showError(error, 'Document Error');
      }
    } finally {
      setIsPickingDocument(false);
    }
  };

  const handleGenerate = () => {
    mediumImpact();
    if (!selectedFile) {
      showWarning('Please upload a PDF document first', 'Missing File');
      return;
    }
    if (!context.trim()) {
      showWarning('Please provide a context or title for generation', 'Missing Context');
      return;
    }
    if (selectedTypes.length === 0) {
      showWarning('Please select at least one question type', 'Missing Types');
      return;
    }

    setIsGenerating(true);
    setGeneratedQuestions([]);
    setProgress(null);
    progressAnim.setValue(0);

    cancelRef.current = questionsService.quickGenerate(
      {
        file: selectedFile,
        context: context.trim(),
        count,
        types: selectedTypes,
        difficulty,
        marks_mcq: selectedTypes.includes('mcq') ? marksMcq : undefined,
        marks_short: selectedTypes.includes('short_answer') ? marksShort : undefined,
        marks_long: selectedTypes.includes('long_answer') ? marksLong : undefined,
        subject_id: selectedSubjectId || undefined,
        topic_id: selectedTopicId || undefined,
      },
      (progressUpdate) => {
        console.log('[QuickGenerate UI] Progress update:', progressUpdate.status, progressUpdate.progress);
        setProgress(progressUpdate);
        Animated.timing(progressAnim, {
          toValue: progressUpdate.progress / 100,
          duration: 300,
          useNativeDriver: false,
        }).start();

        if (progressUpdate.question) {
          console.log('[QuickGenerate UI] New question received:', progressUpdate.question.id);
          setGeneratedQuestions(prev => [...prev, progressUpdate.question!]);
        }
      },
      (documentId) => {
        console.log('[QuickGenerate UI] Complete, documentId:', documentId);
        setIsGenerating(false);
      },
      (error) => {
        console.log('[QuickGenerate UI] Error:', error.message);
        setIsGenerating(false);
        showError(error, 'Generation Failed');
      }
    );
  };

  const handleCancel = () => {
    cancelRef.current?.();
    setIsGenerating(false);
  };

  const toggleType = (type: QuestionType) => {
    selectionImpact();
    setSelectedTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {/* Header */}
      <BlurView intensity={95} style={styles.headerBlur}>
        <LinearGradient
          colors={['#4A90D9', '#357ABD'] as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <IconSymbol name="sparkles" size={48} color="#FFFFFF" weight="semibold" />
          <Text style={styles.headerTitle}>Quick Generate</Text>
          <Text style={styles.headerSubtitle}>
            Upload a PDF and describe what you need
          </Text>
        </LinearGradient>
      </BlurView>

      {/* Upload Section */}
      <GlassCard style={styles.section}>
        {/* <Text style={[styles.sectionTitle, { color: colors.text }]}>Document</Text> */}
        <TouchableOpacity
          style={[
            styles.uploadButton,
            selectedFile && styles.uploadButtonSelected,
            { borderColor: selectedFile ? colors.success : colors.border }
          ]}
          onPress={handlePickDocument}
          disabled={isGenerating}
        >
          <IconSymbol
            name={selectedFile ? "checkmark.circle.fill" : "doc.badge.plus"}
            size={32}
            color={selectedFile ? colors.success : colors.primary}
          />
          <View style={styles.uploadTextContainer}>
            <Text style={[styles.uploadTitle, { color: colors.text }]}>
              {selectedFile ? selectedFile.name : 'Upload PDF'}
            </Text>
            <Text style={[styles.uploadSubtitle, { color: colors.textSecondary }]}>
              {selectedFile ? 'Tap to change' : 'Tap to select a file'}
            </Text>
          </View>
        </TouchableOpacity>
      </GlassCard>

      {/* Context Section */}
      <GlassCard style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Focus On</Text>
        <TextInput
          style={[
            styles.contextInput,
            {
              backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
              color: colors.text,
              borderColor: colors.border,
            }
          ]}
          placeholder="e.g., Chapter 5: Binary Trees and Tree Traversal"
          placeholderTextColor={colors.textTertiary}
          value={context}
          onChangeText={setContext}
          multiline
          numberOfLines={3}
          editable={!isGenerating}
        />
        {/* <Text style={[styles.helperText, { color: colors.textTertiary }]}>
          Describe the topic or provide a title for question generation
        </Text> */}
      </GlassCard>

      {/* Options Section */}
      <GlassCard style={styles.section}>
        {/* <Text style={[styles.sectionTitle, { color: colors.text }]}>Options</Text> */}

        {/* Question Types */}
        {/* <Text style={[styles.optionLabel, { color: colors.textSecondary }]}>Question Types</Text> */}
        <View style={styles.typesContainer}>
          {[
            { type: 'mcq' as QuestionType, label: 'MCQ', icon: 'list.bullet' },
            { type: 'short_answer' as QuestionType, label: 'Short Ans', icon: 'text.alignleft' },
            { type: 'long_answer' as QuestionType, label: 'Long Ans', icon: 'doc.text' },
          ].map(({ type, label, icon }) => (
            <TouchableOpacity
              key={type}
              style={[
                styles.typeButton,
                selectedTypes.includes(type) && { backgroundColor: colors.primary },
                { borderColor: selectedTypes.includes(type) ? colors.primary : colors.border }
              ]}
              onPress={() => toggleType(type)}
              disabled={isGenerating}
            >
              <IconSymbol
                name={icon as any}
                size={18}
                color={selectedTypes.includes(type) ? '#FFFFFF' : colors.textSecondary}
              />
              <Text style={[
                styles.typeButtonText,
                { color: selectedTypes.includes(type) ? '#FFFFFF' : colors.text }
              ]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Count */}
        <Text style={[styles.optionLabel, { color: colors.textSecondary, marginTop: Spacing.lg }]}>
          Number of Questions: {count}
        </Text>
        <View style={styles.sliderRow}>
          <Text style={[styles.sliderLabel, { color: colors.textSecondary }]}>1</Text>
          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={50}
            step={1}
            value={count}
            onValueChange={(val: number) => {
              lightImpact();
              setCount(Math.round(val));
            }}
            onSlidingComplete={() => {
              mediumImpact();
            }}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.primary}
            disabled={isGenerating}
          />
          <Text style={[styles.sliderValue, { color: colors.primary }]}>{count}</Text>
        </View>
        <TouchableOpacity
          style={[styles.customButton, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={() => {
            selectionImpact();
            setShowCustomInput(true);
          }}
          disabled={isGenerating}
        >
          <IconSymbol name="pencil" size={16} color={colors.primary} />
          <Text style={[styles.customButtonText, { color: colors.text }]}>Custom Amount</Text>
        </TouchableOpacity>

        {/* Difficulty */}
        <Text style={[styles.optionLabel, { color: colors.textSecondary, marginTop: Spacing.lg }]}>
          Difficulty
        </Text>
        <View style={styles.difficultyContainer}>
          {[
            { value: 'easy' as Difficulty, label: 'Easy', color: colors.success },
            { value: 'medium' as Difficulty, label: 'Medium', color: colors.warning },
            { value: 'hard' as Difficulty, label: 'Hard', color: colors.error },
          ].map(({ value, label, color }) => (
            <TouchableOpacity
              key={value}
              style={[
                styles.difficultyButton,
                difficulty === value && { backgroundColor: color, borderColor: color },
                { borderColor: difficulty === value ? color : colors.border }
              ]}
              onPress={() => {
                selectionImpact();
                setDifficulty(value);
              }}
              disabled={isGenerating}
            >
              <Text style={[
                styles.difficultyButtonText,
                { color: difficulty === value ? '#FFFFFF' : colors.text }
              ]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Marks per Question Type */}
        <Text style={[styles.optionLabel, { color: colors.textSecondary, marginTop: Spacing.lg }]}>
          Marks per Question Type
        </Text>
        <View style={styles.marksContainer}>
          {selectedTypes.includes('mcq') && (
            <View style={styles.marksInputRow}>
              <Text style={[styles.marksLabel, { color: colors.text }]}>MCQ</Text>
              <View style={styles.marksInputWrapper}>
                <TouchableOpacity
                  style={[styles.marksButton, { backgroundColor: colors.border }]}
                  onPress={() => {
                    mediumImpact();
                    setMarksMcq(Math.max(1, marksMcq - 1));
                  }}
                  disabled={isGenerating}
                >
                  <IconSymbol name="minus" size={14} color={colors.text} />
                </TouchableOpacity>
                <TextInput
                  style={[styles.marksInput, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)', color: colors.text, borderColor: colors.border }]}
                  value={marksMcq.toString()}
                  onChangeText={(v) => setMarksMcq(parseInt(v) || 1)}
                  keyboardType="numeric"
                  editable={!isGenerating}
                />
                <TouchableOpacity
                  style={[styles.marksButton, { backgroundColor: colors.border }]}
                  onPress={() => {
                    mediumImpact();
                    setMarksMcq(marksMcq + 1);
                  }}
                  disabled={isGenerating}
                >
                  <IconSymbol name="plus" size={14} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          )}
          {selectedTypes.includes('short_answer') && (
            <View style={styles.marksInputRow}>
              <Text style={[styles.marksLabel, { color: colors.text }]}>Short Answer</Text>
              <View style={styles.marksInputWrapper}>
                <TouchableOpacity
                  style={[styles.marksButton, { backgroundColor: colors.border }]}
                  onPress={() => {
                    mediumImpact();
                    setMarksShort(Math.max(1, marksShort - 1));
                  }}
                  disabled={isGenerating}
                >
                  <IconSymbol name="minus" size={14} color={colors.text} />
                </TouchableOpacity>
                <TextInput
                  style={[styles.marksInput, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)', color: colors.text, borderColor: colors.border }]}
                  value={marksShort.toString()}
                  onChangeText={(v) => setMarksShort(parseInt(v) || 1)}
                  keyboardType="numeric"
                  editable={!isGenerating}
                />
                <TouchableOpacity
                  style={[styles.marksButton, { backgroundColor: colors.border }]}
                  onPress={() => setMarksShort(marksShort + 1)}
                  disabled={isGenerating}
                >
                  <IconSymbol name="plus" size={14} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          )}
          {selectedTypes.includes('long_answer') && (
            <View style={styles.marksInputRow}>
              <Text style={[styles.marksLabel, { color: colors.text }]}>Long Answer</Text>
              <View style={styles.marksInputWrapper}>
                <TouchableOpacity
                  style={[styles.marksButton, { backgroundColor: colors.border }]}
                  onPress={() => {
                    mediumImpact();
                    setMarksLong(Math.max(1, marksLong - 1));
                  }}
                  disabled={isGenerating}
                >
                  <IconSymbol name="minus" size={14} color={colors.text} />
                </TouchableOpacity>
                <TextInput
                  style={[styles.marksInput, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)', color: colors.text, borderColor: colors.border }]}
                  value={marksLong.toString()}
                  onChangeText={(v) => setMarksLong(parseInt(v) || 1)}
                  keyboardType="numeric"
                  editable={!isGenerating}
                />
                <TouchableOpacity
                  style={[styles.marksButton, { backgroundColor: colors.border }]}
                  onPress={() => {
                    mediumImpact();
                    setMarksLong(marksLong + 1);
                  }}
                  disabled={isGenerating}
                >
                  <IconSymbol name="plus" size={14} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </GlassCard>

      {/* Subject/Topic Linking Section */}
      <GlassCard style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Link to Subject</Text>
        <Text style={[styles.helperText, { color: colors.textTertiary, marginBottom: Spacing.md }]}>
          Associate generated questions with a subject and optionally a specific chapter
        </Text>

        {/* Subject Picker */}
        <Text style={[styles.optionLabel, { color: colors.textSecondary }]}>Subject</Text>
        <TouchableOpacity
          style={[
            styles.pickerButton,
            {
              backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
              borderColor: colors.border,
            }
          ]}
          onPress={() => setShowSubjectPicker(true)}
          disabled={isGenerating || loadingSubjects}
        >
          {loadingSubjects ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <IconSymbol name="book.fill" size={18} color={selectedSubjectId ? colors.primary : colors.textSecondary} />
              <Text style={[styles.pickerText, { color: selectedSubjectId ? colors.text : colors.textTertiary }]}>
                {getSelectedSubject()?.name || 'Select a subject'}
              </Text>
              <IconSymbol name="chevron.down" size={14} color={colors.textSecondary} />
            </>
          )}
        </TouchableOpacity>
        {selectedSubjectId && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => {
              setSelectedSubjectId(null);
              setSelectedTopicId(null);
            }}
          >
            <Text style={[styles.clearButtonText, { color: colors.error }]}>Clear subject</Text>
          </TouchableOpacity>
        )}

        {/* Topic Picker - Only show if subject is selected */}
        {selectedSubjectId && (
          <>
            <Text style={[styles.optionLabel, { color: colors.textSecondary, marginTop: Spacing.lg }]}>Chapter/Topic</Text>
            <TouchableOpacity
              style={[
                styles.pickerButton,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                  borderColor: colors.border,
                }
              ]}
              onPress={() => setShowTopicPicker(true)}
              disabled={isGenerating || loadingTopics}
            >
              {loadingTopics ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <IconSymbol name="doc.text.fill" size={18} color={selectedTopicId ? colors.primary : colors.textSecondary} />
                  <Text style={[styles.pickerText, { color: selectedTopicId ? colors.text : colors.textTertiary }]}>
                    {getSelectedTopic()?.name || 'Select a chapter (optional)'}
                  </Text>
                  <IconSymbol name="chevron.down" size={14} color={colors.textSecondary} />
                </>
              )}
            </TouchableOpacity>
            {selectedTopicId && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => setSelectedTopicId(null)}
              >
                <Text style={[styles.clearButtonText, { color: colors.error }]}>Clear chapter</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </GlassCard>

      {/* Subject Picker Modal */}
      <Modal
        visible={showSubjectPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSubjectPicker(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeaderBar}>
            <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
          </View>
          <View style={styles.modalTop}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Select Subject</Text>
            <TouchableOpacity onPress={() => setShowSubjectPicker(false)}>
              <IconSymbol name="xmark.circle.fill" size={28} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalDivider} />
          <ScrollView style={styles.modalScrollContent}>

            {subjects.length === 0 ? (
              <View style={styles.emptyList}>
                <Text style={[styles.emptyListText, { color: colors.textSecondary }]}>
                  No subjects available. Create a subject first.
                </Text>
              </View>
            ) : (
              subjects.map((subject) => (
                <TouchableOpacity
                  key={subject.id}
                  style={[
                    styles.modalItem,
                    { borderBottomColor: colors.border },
                    selectedSubjectId === subject.id && { backgroundColor: colors.primary + '15' }
                  ]}
                  onPress={() => {
                    setSelectedSubjectId(subject.id);
                    setSelectedTopicId(null);
                    setShowSubjectPicker(false);
                  }}
                >
                  <View style={styles.modalItemContent}>
                    <Text style={[styles.modalItemTitle, { color: colors.text }]}>{subject.name}</Text>
                    <Text style={[styles.modalItemSubtitle, { color: colors.textSecondary }]}>
                      {subject.code} • {subject.total_topics} topics
                    </Text>
                  </View>
                  {selectedSubjectId === subject.id && (
                    <IconSymbol name="checkmark.circle.fill" size={22} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Topic Picker Modal */}
      <Modal
        visible={showTopicPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowTopicPicker(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeaderBar}>
            <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
          </View>
          <View style={styles.modalTop}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Select Chapter</Text>
            <TouchableOpacity onPress={() => setShowTopicPicker(false)}>
              <IconSymbol name="xmark.circle.fill" size={28} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalDivider} />
          <ScrollView style={styles.modalScrollContent}>

            {topics.length === 0 ? (
              <View style={styles.emptyList}>
                <Text style={[styles.emptyListText, { color: colors.textSecondary }]}>
                  No topics available for this subject.
                </Text>
              </View>
            ) : (
              topics.map((topic) => (
                <TouchableOpacity
                  key={topic.id}
                  style={[
                    styles.modalItem,
                    { borderBottomColor: colors.border },
                    selectedTopicId === topic.id && { backgroundColor: colors.primary + '15' }
                  ]}
                  onPress={() => {
                    setSelectedTopicId(topic.id);
                    setShowTopicPicker(false);
                  }}
                >
                  <View style={styles.modalItemContent}>
                    <Text style={[styles.modalItemTitle, { color: colors.text }]}>{topic.name}</Text>
                    {topic.description && (
                      <Text style={[styles.modalItemSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                        {topic.description}
                      </Text>
                    )}
                  </View>
                  {selectedTopicId === topic.id && (
                    <IconSymbol name="checkmark.circle.fill" size={22} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Progress Section */}
      {isGenerating && progress && (
        <GlassCard style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Generating...</Text>
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: colors.primary,
                    width: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    })
                  }
                ]}
              />
            </View>
            <Text style={[styles.progressText, { color: colors.textSecondary }]}>
              {progress.message || `${progress.progress}%`}
            </Text>
          </View>
          {progress.current_question && progress.total_questions && (
            <Text style={[styles.progressCount, { color: colors.primary }]}>
              {progress.current_question} / {progress.total_questions} questions
            </Text>
          )}
        </GlassCard>
      )}

      {/* Generated Questions Preview */}
      {generatedQuestions.length > 0 && (
        <GlassCard style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Generated Questions ({generatedQuestions.length})
          </Text>
          {generatedQuestions.map((q, index) => (
            <View key={q.id} style={[styles.questionPreview, { borderColor: colors.border }]}>
              <View style={styles.questionHeader}>
                <View style={[styles.questionBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.questionBadgeText}>{q.question_type?.toUpperCase()}</Text>
                </View>
                {q.difficulty_level && (
                  <View style={[styles.difficultyBadge, {
                    backgroundColor: q.difficulty_level === 'easy' ? '#34C759' :
                      q.difficulty_level === 'medium' ? '#FF9500' : '#FF3B30'
                  }]}>
                    <Text style={styles.questionBadgeText}>{q.difficulty_level.toUpperCase()}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.questionText, { color: colors.text }]}>
                {q.question_text}
              </Text>

              {/* Source References */}
              {q.source_info && <QuestionSources sourceInfo={q.source_info} compact />}

              {/* Assigned LO / CO / Topic badges (if present) */}
              <View style={styles.generatedMetaRow}>
                {(q as any).learning_outcome_id ? (
                  <Text style={[styles.generatedMetaText, { color: colors.textSecondary }]}>{(q as any).learning_outcome_id}</Text>
                ) : null}

                {(q as any).course_outcome_mapping && Object.keys((q as any).course_outcome_mapping).length ? (
                  <Text style={[styles.generatedMetaText, { color: colors.textSecondary }]}>{Object.keys((q as any).course_outcome_mapping).join(', ')}</Text>
                ) : null}

                {q.topic_tags && q.topic_tags.length ? (
                  <Text style={[styles.generatedMetaText, { color: colors.textSecondary }]}>{q.topic_tags[0]}</Text>
                ) : null}
              </View>

              {q.options && q.options.length > 0 && (
                <View style={styles.optionsContainer}>
                  {q.options.map((opt, optIdx) => {
                    const isCorrect = q.correct_answer && opt.startsWith(q.correct_answer);
                    return (
                      <View
                        key={optIdx}
                        style={[
                          styles.optionRow,
                          isCorrect && { backgroundColor: colors.success + '20', borderRadius: BorderRadius.sm, padding: 4 }
                        ]}
                      >
                        <Text style={[styles.optionText, { color: isCorrect ? colors.success : colors.textSecondary }]}>
                          {opt}
                        </Text>
                        {isCorrect && (
                          <IconSymbol name="checkmark.circle.fill" size={16} color={colors.success} />
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
              {q.correct_answer && q.question_type !== 'mcq' && (
                <View style={[styles.answerContainer, { backgroundColor: colors.success + '10', borderColor: colors.success + '30' }]}>
                  <Text style={[styles.answerLabel, { color: colors.success }]}>Expected Answer:</Text>
                  <Text style={[styles.answerText, { color: colors.text }]}>{q.correct_answer}</Text>
                </View>
              )}
            </View>
          ))}

          {/* Action Buttons after generation */}
          {progress?.status === 'complete' && (
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.primary }]}
                onPress={() => router.push('/(tabs)/home/vetting')}
              >
                <IconSymbol name="checkmark.shield.fill" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>Review & Validate</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.success }]}
                onPress={() => {
                  setGeneratedQuestions([]);
                  setProgress(null);
                  setSelectedFile(null);
                  setContext('');
                }}
              >
                <IconSymbol name="plus.circle.fill" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>Generate More</Text>
              </TouchableOpacity>
            </View>
          )}
        </GlassCard>
      )}

      {/* Generate Button */}
      <TouchableOpacity
        style={[styles.generateButton, isGenerating && styles.generateButtonDisabled]}
        onPress={isGenerating ? handleCancel : handleGenerate}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={isGenerating ? ['#FF3B30', '#FF453A'] : ['#4A90D9', '#357ABD'] as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.generateButtonGradient}
        >
          {isGenerating ? (
            <>
              <ActivityIndicator color="#FFFFFF" style={{ marginRight: Spacing.sm }} />
              <Text style={styles.generateButtonText}>Cancel</Text>
            </>
          ) : (
            <>
              <IconSymbol name="sparkles" size={32} color="#FFFFFF" weight="semibold" />
              <Text style={styles.generateButtonText}>Generate Questions</Text>
            </>
          )}
        </LinearGradient>
      </TouchableOpacity>

      {/* Bottom padding for tab bar */}
      <View style={{ height: 100 }} />

      {/* Custom Count Input Modal */}
      <Modal
        visible={showCustomInput}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCustomInput(false)}
      >
        <View style={styles.customInputModal}>
          <View style={[styles.customInputContainer, { backgroundColor: colors.card }]}>
            <Text style={[styles.customInputTitle, { color: colors.text }]}>
              Enter Number of Questions
            </Text>
            <TextInput
              style={[styles.customInput, {
                borderColor: colors.border,
                color: colors.text,
                backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
              }]}
              value={customCount}
              onChangeText={setCustomCount}
              keyboardType="number-pad"
              placeholder="e.g., 25"
              placeholderTextColor={colors.textSecondary}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.customInputButtons}>
              <TouchableOpacity
                style={[styles.customInputButton, { backgroundColor: colors.border }]}
                onPress={() => {
                  selectionImpact();
                  setShowCustomInput(false);
                  setCustomCount('');
                }}
              >
                <Text style={[styles.customInputButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.customInputButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  mediumImpact();
                  const num = parseInt(customCount, 10);
                  if (!isNaN(num) && num >= 1 && num <= 150) {
                    setCount(num);
                    setShowCustomInput(false);
                    setCustomCount('');
                  } else {
                    showError(new Error('Please enter a number between 1 and 150'), 'Invalid input');
                  }
                }}
              >
                <Text style={[styles.customInputButtonText, { color: '#FFFFFF' }]}>Set</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  headerBlur: {
    overflow: 'hidden',
    borderRadius: BorderRadius.xxl,
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
    marginHorizontal: Spacing.md,
    ...Shadows.medium,
  },
  header: {
    paddingTop: 20,
    paddingBottom: Spacing.xxxl,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: FontSizes.xxxl,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: Spacing.md,
  },
  headerSubtitle: {
    fontSize: FontSizes.md,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  glassCardContainer: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    ...Shadows.medium,
  },
  glassCard: {
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
  },
  section: {
    marginBottom: Spacing.lg,
    marginRight: Spacing.lg,
    marginLeft: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  uploadButtonSelected: {
    borderStyle: 'solid',
  },
  uploadTextContainer: {
    marginLeft: Spacing.md,
    flex: 1,
  },
  uploadTitle: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  uploadSubtitle: {
    fontSize: FontSizes.sm,
    marginTop: 2,
  },
  contextInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSizes.md,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  helperText: {
    fontSize: FontSizes.xs,
    marginTop: Spacing.sm,
  },
  optionLabel: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
    marginBottom: Spacing.sm,
  },
  typesContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  typeButtonText: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sliderLabel: {
    fontSize: FontSizes.sm,
    minWidth: 20,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  sliderValue: {
    fontSize: FontSizes.lg,
    fontWeight: '700',
    minWidth: 40,
    textAlign: 'right',
  },
  customButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  customButtonText: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  customInputModal: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  customInputContainer: {
    width: '80%',
    padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
    gap: Spacing.md,
  },
  customInputTitle: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
    textAlign: 'center',
  },
  customInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    fontSize: FontSizes.lg,
    fontWeight: '600',
    textAlign: 'center',
  },
  customInputButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  customInputButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  customInputButtonText: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  difficultyContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  difficultyButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  difficultyButtonText: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  marksContainer: {
    gap: Spacing.sm,
  },
  marksInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  marksLabel: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
    flex: 1,
  },
  marksInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  marksButton: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  marksInput: {
    width: 50,
    height: 36,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    textAlign: 'center',
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  pickerText: {
    flex: 1,
    fontSize: FontSizes.md,
  },
  clearButton: {
    marginTop: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  clearButtonText: {
    fontSize: FontSizes.sm,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeaderBar: {
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  modalTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
  },
  modalDivider: {
    height: 1,
    backgroundColor: 'rgba(128, 128, 128, 0.2)',
    marginHorizontal: Spacing.lg,
  },
  modalScrollContent: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  modalItemContent: {
    flex: 1,
  },
  modalItemTitle: {
    fontSize: FontSizes.md,
    fontWeight: '500',
  },
  modalItemSubtitle: {
    fontSize: FontSizes.sm,
    marginTop: 2,
  },
  emptyList: {
    padding: Spacing.xl,
    alignItems: 'center',
  },
  emptyListText: {
    fontSize: FontSizes.sm,
    textAlign: 'center',
  },
  progressContainer: {
    marginTop: Spacing.sm,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    fontSize: FontSizes.sm,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  progressCount: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  questionPreview: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  questionBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
  },
  questionBadgeText: {
    color: '#FFFFFF',
    fontSize: FontSizes.xs,
    fontWeight: '600',
  },
  questionText: {
    fontSize: FontSizes.sm,
    lineHeight: 20,
  },
  optionsContainer: {
    marginTop: Spacing.sm,
    paddingLeft: Spacing.sm,
  },
  optionText: {
    fontSize: FontSizes.xs,
    lineHeight: 18,
    marginBottom: 4,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  generatedMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  generatedMetaText: {
    fontSize: FontSizes.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    backgroundColor: 'rgba(128, 128, 128, 0.15)',
    overflow: 'hidden',
  },
  difficultyBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  answerContainer: {
    marginTop: Spacing.md,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  answerLabel: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
    marginBottom: 4,
  },
  answerText: {
    fontSize: FontSizes.sm,
    lineHeight: 18,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  generateButton: {
    marginHorizontal: Spacing.xxxl + 60,
    marginTop: Spacing.xl,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    ...Shadows.large,
  },
  generateButtonDisabled: {},
  generateButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  generateButtonText: {
    color: '#FFFFFF',
    fontSize: FontSizes.lg,
    fontWeight: '600',
  },
});
