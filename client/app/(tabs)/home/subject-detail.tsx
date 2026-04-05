import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  Animated,
} from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing, BorderRadius, FontSizes } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  subjectsService,
  Subject,
  Topic,
  TopicCreateData,
  PendingEnrollment,
  generateLearningContent,
  generateTopicContent,
} from '@/services/subjects';
import { referencesService, ReferenceDocument } from '@/services/references';
import { ReferenceMaterials } from '@/components/reference-materials';
import * as DocumentPicker from 'expo-document-picker';
import { useToast } from '@/components/toast';
import { rubricsService, Rubric, RubricCreateData, GenerationProgress } from '@/services/rubrics';
import { questionsService, GenerationSession, SessionQuestion, Question } from '@/services/questions';
import { ExportModal } from '@/components/export-modal';
import { mediumImpact, heavyImpact, selectionImpact } from '@/utils/haptics';

export default function SubjectDetailScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { id } = useLocalSearchParams<{ id: string }>();
  const { showError, showSuccess, showWarning } = useToast();

  const [subject, setSubject] = useState<Subject | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddTopicModal, setShowAddTopicModal] = useState(false);
  const [showTopicDetailModal, setShowTopicDetailModal] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [newTopicName, setNewTopicName] = useState('');
  const [newTopicDescription, setNewTopicDescription] = useState('');
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [syllabusContent, setSyllabusContent] = useState('');

  // New state for syllabus chapter extraction
  const [isExtractingChapters, setIsExtractingChapters] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState('');
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [generatingContentTopicId, setGeneratingContentTopicId] = useState<string | null>(null);

  // Subject edit modal state
  const [showEditSubjectModal, setShowEditSubjectModal] = useState(false);
  const [editSubjectName, setEditSubjectName] = useState('');
  const [editSubjectCode, setEditSubjectCode] = useState('');
  const [editSubjectDescription, setEditSubjectDescription] = useState('');
  const [isSavingSubject, setIsSavingSubject] = useState(false);

  // Tab state for switching between chapters, references, and history
  const [activeTab, setActiveTab] = useState<'chapters' | 'references' | 'history' | 'enrollments'>('chapters');

  // Enrollment management state
  const [pendingEnrollments, setPendingEnrollments] = useState<PendingEnrollment[]>([]);
  const [approvedStudents, setApprovedStudents] = useState<PendingEnrollment[]>([]);
  const [isLoadingEnrollments, setIsLoadingEnrollments] = useState(false);
  const [processingEnrollmentId, setProcessingEnrollmentId] = useState<string | null>(null);

  // Reference materials state
  const [referenceBooks, setReferenceBooks] = useState<ReferenceDocument[]>([]);
  const [templatePapers, setTemplatePapers] = useState<ReferenceDocument[]>([]);
  const [referenceQuestions, setReferenceQuestions] = useState<ReferenceDocument[]>([]);
  const [isLoadingReferences, setIsLoadingReferences] = useState(false);

  // Chapter generation state
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateTopic, setGenerateTopic] = useState<Topic | null>(null);
  const [genTab, setGenTab] = useState<'quick' | 'existing'>('quick');
  const [existingRubrics, setExistingRubrics] = useState<Rubric[]>([]);
  const [isLoadingRubrics, setIsLoadingRubrics] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<GenerationProgress | null>(null);
  const [genQuestions, setGenQuestions] = useState<Array<{ id: string; question_text: string; question_type: string; marks: number; learning_outcome_id?: string | null; course_outcome_mapping?: Record<string, number> | null }>>([]);
  const cancelGenRef = useRef<(() => void) | null>(null);
  const genProgressAnim = useRef(new Animated.Value(0)).current;
  // Quick generate form
  const [qgMcqCount, setQgMcqCount] = useState('0');
  const [qgShortCount, setQgShortCount] = useState('0');
  const [qgLongCount, setQgLongCount] = useState('0');
  const [qgMcqMarks, setQgMcqMarks] = useState('1');
  const [qgShortMarks, setQgShortMarks] = useState('2');
  const [qgLongMarks, setQgLongMarks] = useState('5');

  // Import state
  const [isImporting, setIsImporting] = useState(false);

  // Track if any document picker is currently open
  const [isPickingDocument, setIsPickingDocument] = useState(false);

  // History state
  const [historySessions, setHistorySessions] = useState<GenerationSession[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historySessionQuestions, setHistorySessionQuestions] = useState<SessionQuestion[]>([]);
  const [selectedHistorySession, setSelectedHistorySession] = useState<GenerationSession | null>(null);
  const [isLoadingSessionQuestions, setIsLoadingSessionQuestions] = useState(false);

  // Export state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportQuestions, setExportQuestions] = useState<Question[]>([]);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [subjectData, topicsData] = await Promise.all([
        subjectsService.getSubject(id),
        subjectsService.listTopics(id, 1, 100),
      ]);
      setSubject(subjectData);
      setTopics(topicsData.topics);
      // Also load enrollment requests
      try {
        const enrollments = await subjectsService.getEnrollmentRequests(id);
        setPendingEnrollments(enrollments);
      } catch { /* enrollment API may not exist yet */ }
    } catch (error) {
      console.error('Error loading subject:', error);
      showError(error, 'Failed to Load');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [id]);

  const loadEnrollments = useCallback(async () => {
    if (!id) return;
    setIsLoadingEnrollments(true);
    try {
      const [pending, approved] = await Promise.all([
        subjectsService.getEnrollmentRequests(id),
        subjectsService.getAllEnrollments('approved').then(all => all.filter(e => e.subject_id === id)).catch(() => []),
      ]);
      setPendingEnrollments(pending);
      setApprovedStudents(approved);
    } catch (error) {
      console.error('Error loading enrollments:', error);
    } finally {
      setIsLoadingEnrollments(false);
    }
  }, [id]);

  const handleApproveEnrollment = async (enrollmentId: string) => {
    if (!id) return;
    setProcessingEnrollmentId(enrollmentId);
    try {
      await subjectsService.approveEnrollment(id, enrollmentId);
      showSuccess('Student enrollment approved');
      await loadEnrollments();
    } catch (error) {
      showError(error, 'Failed to Approve');
    } finally {
      setProcessingEnrollmentId(null);
    }
  };

  const handleRejectEnrollment = async (enrollmentId: string) => {
    if (!id) return;
    Alert.alert(
      'Reject Enrollment',
      'Are you sure you want to reject this enrollment request?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setProcessingEnrollmentId(enrollmentId);
            try {
              await subjectsService.rejectEnrollment(id, enrollmentId);
              showSuccess('Enrollment request rejected');
              await loadEnrollments();
            } catch (error) {
              showError(error, 'Failed to Reject');
            } finally {
              setProcessingEnrollmentId(null);
            }
          },
        },
      ]
    );
  };

  const loadReferences = useCallback(async () => {
    if (!id) return;
    setIsLoadingReferences(true);
    try {
      const data = await referencesService.listReferences(id);
      setReferenceBooks(data.reference_books || []);
      setTemplatePapers(data.template_papers || []);
      setReferenceQuestions(data.reference_questions || []);
    } catch (error) {
      console.error('Error loading references:', error);
      // Don't show error for references, they may not exist yet
    } finally {
      setIsLoadingReferences(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
    loadReferences();
    loadEnrollments();
  }, [loadData, loadReferences, loadEnrollments]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

  // Edit subject
  const handleEditSubject = async () => {
    if (!editSubjectName.trim() || !editSubjectCode.trim()) {
      showError('Please enter subject name and code');
      return;
    }

    setIsSavingSubject(true);
    try {
      await subjectsService.updateSubject(id as string, {
        name: editSubjectName.trim(),
        code: editSubjectCode.trim(),
        description: editSubjectDescription.trim(),
      });
      showSuccess(`Subject ${editSubjectCode} updated successfully`);
      setShowEditSubjectModal(false);
      loadData();
    } catch (err: any) {
      showError(err?.response?.data?.detail || 'Failed to update subject');
    } finally {
      setIsSavingSubject(false);
    }
  };

  const handleCreateTopic = async () => {
    if (!newTopicName.trim() || !id) {
      showWarning('Please enter a topic name', 'Missing Information');
      return;
    }

    mediumImpact();
    setIsCreatingTopic(true);
    try {
      const data: TopicCreateData = {
        subject_id: id,
        name: newTopicName.trim(),
        description: newTopicDescription.trim() || undefined,
        order_index: topics.length,
      };
      await subjectsService.createTopic(id, data);
      setShowAddTopicModal(false);
      setNewTopicName('');
      setNewTopicDescription('');
      loadData();
      showSuccess('Chapter created successfully');
    } catch (error) {
      showError(error, 'Failed to Create');
    } finally {
      setIsCreatingTopic(false);
    }
  };

  const handleDeleteTopic = async (topic: Topic) => {
    if (!id) return;
    mediumImpact();
    Alert.alert(
      'Delete Chapter',
      `Are you sure you want to delete "${topic.name}"? This will also delete all associated questions.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              heavyImpact();
              await subjectsService.deleteTopic(id, topic.id);
              loadData();
              showSuccess('Chapter deleted');
            } catch (error) {
              showError(error, 'Failed to Delete');
            }
          },
        },
      ]
    );
  };

  const handleTopicPress = (topic: Topic) => {
    mediumImpact();
    setSelectedTopic(topic);
    setSyllabusContent(topic.syllabus_content || '');
    setShowTopicDetailModal(true);
  };

  // ---- Chapter Generation ----
  const openGenerateModal = async (topic: Topic) => {
    mediumImpact();
    setGenerateTopic(topic);
    setGenTab('quick');
    setGenProgress(null);
    setGenQuestions([]);
    setIsGenerating(false);
    setQgMcqCount('5');
    setQgShortCount('3');
    setQgLongCount('0');
    setQgMcqMarks('2');
    setQgShortMarks('5');
    setQgLongMarks('10');
    setShowGenerateModal(true);
    // Load existing rubrics for this subject
    setIsLoadingRubrics(true);
    try {
      const data = await rubricsService.listRubrics(1, 50, id);
      setExistingRubrics(data.rubrics || []);
    } catch { setExistingRubrics([]); }
    setIsLoadingRubrics(false);
  };

  const closeGenerateModal = () => {
    if (cancelGenRef.current) cancelGenRef.current();
    setShowGenerateModal(false);
    setIsGenerating(false);
    setGenProgress(null);
    setGenQuestions([]);
    setGenerateTopic(null);
    loadData(); // refresh data only after modal is closed
  };

  const runGeneration = (rubricId: string, isTempRubric: boolean) => {
    setIsGenerating(true);
    setGenQuestions([]);
    setGenProgress(null);
    genProgressAnim.setValue(0);

    const cancel = rubricsService.generateFromRubric(
      rubricId,
      (progress) => {
        setGenProgress(progress);
        if (progress.progress) {
          Animated.timing(genProgressAnim, {
            toValue: progress.progress,
            duration: 300,
            useNativeDriver: false,
          }).start();
        }
        if (progress.question) {
          setGenQuestions((prev) => [...prev, progress.question!]);
        }
        if (progress.status === 'error') {
          showError(new Error(progress.message || 'Generation failed'), 'Generation Failed');
          setIsGenerating(false);
        }
      },
      async () => {
        // Don't setIsGenerating(false) yet — let completion UI stay visible
        if (isTempRubric) {
          try { await rubricsService.deleteRubric(rubricId); } catch { }
        }
      },
      async (error) => {
        showError(error, 'Generation Failed');
        setIsGenerating(false);
        if (isTempRubric) {
          try { await rubricsService.deleteRubric(rubricId); } catch { }
        }
      },
      generateTopic?.id,
    );
    cancelGenRef.current = cancel;
  };

  const handleQuickGenerate = () => {
    console.log('[SubjectDetail] handleQuickGenerate called, topic:', generateTopic?.name);
    if (!generateTopic || !id) {
      console.log('[SubjectDetail] Missing generateTopic or id, aborting');
      return;
    }
    const mcq = parseInt(qgMcqCount) || 0;
    const short = parseInt(qgShortCount) || 0;
    const long = parseInt(qgLongCount) || 0;
    if (mcq + short + long === 0) {
      showWarning('Add at least one question', 'Missing Information');
      return;
    }
    setIsGenerating(true);
    setGenQuestions([]);
    setGenProgress(null);
    genProgressAnim.setValue(0);

    const dist: Record<string, { count: number; marks_each: number }> = {};
    if (mcq > 0) dist.mcq = { count: mcq, marks_each: parseInt(qgMcqMarks) || 2 };
    if (short > 0) dist.short_notes = { count: short, marks_each: parseInt(qgShortMarks) || 5 };
    if (long > 0) dist.essay = { count: long, marks_each: parseInt(qgLongMarks) || 10 };

    console.log('[SubjectDetail] Starting generation with dist:', JSON.stringify(dist));
    const cancel = rubricsService.generateChapter(
      generateTopic.id,
      dist,
      (progress) => {
        setGenProgress(progress);
        if (progress.progress) {
          Animated.timing(genProgressAnim, {
            toValue: progress.progress,
            duration: 300,
            useNativeDriver: false,
          }).start();
        }
        if (progress.question) {
          setGenQuestions((prev) => [...prev, progress.question!]);
        }
        if (progress.status === 'error') {
          showError(new Error(progress.message || 'Generation failed'), 'Generation Failed');
          setIsGenerating(false);
        }
      },
      () => {
        // Don't setIsGenerating(false) — let completion UI stay visible
      },
      (error) => {
        showError(error, 'Generation Failed');
        setIsGenerating(false);
      },
    );
    cancelGenRef.current = cancel;
  };

  const handleUseExistingRubric = (rubric: Rubric) => {
    runGeneration(rubric.id, false);
  };

  const handleUploadSyllabus = async () => {
    if (!selectedTopic || !id) return;

    // Prevent concurrent document picking
    if (isPickingDocument) {
      showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      return;
    }

    mediumImpact();
    setIsUploadingDoc(true);
    setIsPickingDocument(true);
    setUploadStatus('Selecting file...');
    try {
      // Pick a document
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsUploadingDoc(false);
        setUploadStatus('');
        return;
      }

      const file = result.assets[0];
      const fileSizeMB = file.size ? (file.size / (1024 * 1024)).toFixed(1) : '?';

      setUploadStatus(`Uploading ${file.name} (${fileSizeMB}MB)...`);

      // Small delay to ensure UI updates
      await new Promise(resolve => setTimeout(resolve, 100));

      setUploadStatus('Extracting text from document...');

      // Upload directly to topic - this extracts text and saves to syllabus_content
      await subjectsService.uploadTopicSyllabus(
        id,
        selectedTopic.id,
        file.uri,
        file.name,
        file.mimeType || 'application/pdf'
      );

      setUploadStatus('Complete!');
      showSuccess('Syllabus content extracted and saved');
      setShowTopicDetailModal(false);
      loadData();
    } catch (error: unknown) {
      // Check for concurrent picker error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('document picking in progress') || errorMessage.includes('Different document picking')) {
        showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      } else {
        showError(error, 'Upload Failed');
      }
    } finally {
      setIsUploadingDoc(false);
      setIsPickingDocument(false);
      setUploadStatus('');
    }
  };

  const handleSaveSyllabus = async () => {
    if (!selectedTopic || !id) return;

    mediumImpact();
    try {
      await subjectsService.updateTopic(id, selectedTopic.id, {
        syllabus_content: syllabusContent,
        has_syllabus: syllabusContent.trim().length > 0,
      });
      showSuccess('Syllabus content saved');
      setShowTopicDetailModal(false);
      loadData();
    } catch (error) {
      showError(error, 'Failed to Save');
    }
  };

  // Handle syllabus PDF upload with AI chapter extraction
  const handleExtractChaptersFromSyllabus = async () => {
    if (!id) return;

    // Prevent concurrent document picking
    if (isPickingDocument) {
      showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      return;
    }

    setIsExtractingChapters(true);
    setIsPickingDocument(true);
    setExtractionStatus('Selecting file...');

    try {
      // Pick a document
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsExtractingChapters(false);
        setExtractionStatus('');
        return;
      }

      const file = result.assets[0];
      const fileSizeMB = file.size ? (file.size / (1024 * 1024)).toFixed(1) : '?';

      setExtractionStatus(`Uploading ${file.name} (${fileSizeMB}MB)...`);

      // Small delay to ensure UI updates
      await new Promise(resolve => setTimeout(resolve, 100));

      setExtractionStatus('Analyzing syllabus...');

      // Another delay to show the analyzing message
      await new Promise(resolve => setTimeout(resolve, 200));

      setExtractionStatus('Extracting chapters...');

      // Call the API to extract chapters
      const response = await subjectsService.extractChaptersFromSyllabus(
        id,
        file.uri,
        file.name,
        file.mimeType || 'application/pdf'
      );

      setExtractionStatus('Complete!');
      showSuccess(`Successfully added ${response.chapters_created} chapters from syllabus`);
      loadData();
    } catch (error: unknown) {
      // Check for concurrent picker error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('document picking in progress') || errorMessage.includes('Different document picking')) {
        showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      } else {
        showError(error, 'Extraction Failed');
      }
    } finally {
      setIsExtractingChapters(false);
      setIsPickingDocument(false);
      setExtractionStatus('');
    }
  };

  const getTopicColor = (index: number) => {
    const topicColors = ['#007AFF', '#FF9500', '#34C759', '#AF52DE', '#FF3B30', '#5AC8FA', '#FFCC00', '#FF2D55', '#4CD964', '#FF6B6B'];
    return topicColors[index % topicColors.length];
  };

  // ---- Import Questions ----
  const handleImportQuestions = async (topicId?: string) => {
    // Prevent concurrent document picking
    if (isPickingDocument) {
      showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      return;
    }

    mediumImpact();
    setIsImporting(true);
    setIsPickingDocument(true);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv',
          'application/vnd.ms-excel',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const file = result.assets[0];

      const response = await questionsService.importQuestions(
        { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' },
        id,
        topicId,
      );

      showSuccess(`Imported ${response.imported} questions${response.skipped > 0 ? `, ${response.skipped} skipped` : ''}`);
      loadData(); // Refresh to show new question count
    } catch (error) {
      console.error('Import failed:', error);
      // Check for concurrent picker error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('document picking in progress') || errorMessage.includes('Different document picking')) {
        showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      } else {
        showError(error, 'Import Failed');
      }
    } finally {
      setIsImporting(false);
      setIsPickingDocument(false);
    }
  };

  // ---- Load History Sessions ----
  const loadHistory = useCallback(async () => {
    if (!id) return;
    setIsLoadingHistory(true);
    try {
      const data = await questionsService.listSessions(undefined, id, 1, 50);
      setHistorySessions(data.sessions);
    } catch (error) {
      console.error('Error loading history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [id]);

  const openHistorySession = async (session: GenerationSession) => {
    mediumImpact();
    setSelectedHistorySession(session);
    setIsLoadingSessionQuestions(true);
    try {
      const data = await questionsService.getSessionQuestions(session.id);
      setHistorySessionQuestions(data.questions);
    } catch (error) {
      console.error('Error loading session questions:', error);
      setHistorySessionQuestions([]);
    } finally {
      setIsLoadingSessionQuestions(false);
    }
  };

  const handleDeleteHistorySession = (session: GenerationSession) => {
    heavyImpact();
    Alert.alert(
      'Delete Generation History',
      `Delete this session with ${session.questions_generated} questions? This will also delete all the questions generated in this session.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await questionsService.deleteSession(session.id);
              showSuccess('Generation history deleted');
              // Refresh both history and subject data to update stats
              await Promise.all([loadHistory(), loadData()]);
            } catch (error) {
              showError(error, 'Failed to delete');
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!subject) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: colors.background }]}>
        <IconSymbol name="exclamationmark.triangle" size={48} color={colors.error} />
        <Text style={[styles.errorText, { color: colors.text }]}>Subject not found</Text>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.primary }]}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: subject.code,
          headerBackTitle: 'Subjects',
          headerRight: () => (
            <TouchableOpacity
              onPress={async () => {
                mediumImpact();
                try {
                  // Paginate to load all questions (API max limit is 100)
                  let allQuestions: Question[] = [];
                  let currentPage = 1;
                  let hasMore = true;
                  while (hasMore) {
                    const response = await questionsService.listQuestions(currentPage, 100, undefined, undefined, undefined, id, false);
                    allQuestions = [...allQuestions, ...response.questions];
                    hasMore = currentPage < response.pagination.total_pages;
                    currentPage++;
                  }
                  setExportQuestions(allQuestions);
                  setShowExportModal(true);
                } catch (error) {
                  showError(error, 'Failed to load questions for export');
                }
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ width: 35, height: 20, alignItems: 'center', justifyContent: 'center' }}
            >
              <IconSymbol name="square.and.arrow.up" size={22} color={colors.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        >
          {/* Subject Header */}
          <LinearGradient
            colors={['#4A90D9', '#357ABD'] as const}
            style={styles.headerCard}
          >
            <View style={styles.headerContent}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={styles.subjectCode}>{subject.code}</Text>
                  <Text style={styles.subjectName}>{subject.name}</Text>
                </View>
                <TouchableOpacity
                  style={{ padding: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20 }}
                  onPress={() => {
                    setEditSubjectName(subject.name);
                    setEditSubjectCode(subject.code);
                    setEditSubjectDescription(subject.description || '');
                    setShowEditSubjectModal(true);
                  }}
                >
                  <IconSymbol name="pencil" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
              {subject.description && (
                <Text style={styles.subjectDescription}>{subject.description}</Text>
              )}
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{topics.length}</Text>
                <Text style={styles.statLabel}>Topics</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{subject.total_questions}</Text>
                <Text style={styles.statLabel}>Questions</Text>
              </View>
              <View style={styles.statDivider} />
              <TouchableOpacity style={styles.statItem} onPress={() => { setActiveTab('enrollments'); loadEnrollments(); }}>
                <Text style={styles.statValue}>{approvedStudents.length}</Text>
                <Text style={styles.statLabel}>Students</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>

          {/* Quick Actions */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.primary }]}
              onPress={() => {
                mediumImpact();
                router.push(`/(tabs)/home/generate?subjectId=${id}` as never);
              }}
            >
              <IconSymbol name="sparkles" size={18} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Generate</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.secondary }]}
              onPress={() => {
                mediumImpact();
                router.push(`/(tabs)/home/questions?subjectId=${id}` as never);
              }}
            >
              <IconSymbol name="list.bullet" size={18} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Q&A's</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#FF9500' }]}
              onPress={() => handleImportQuestions()}
              disabled={isImporting}
            >
              {isImporting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <IconSymbol name="square.and.arrow.down.fill" size={18} color="#FFFFFF" />
              )}
              <Text style={styles.actionButtonText}>{isImporting ? 'Importing...' : "Import Q&A's"}</Text>
            </TouchableOpacity>
          </View>

          {/* Tab Selector */}
          <View style={[styles.tabSelector, { backgroundColor: colors.card }]}>
            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === 'chapters' && { backgroundColor: colors.primary },
              ]}
              onPress={() => {
                selectionImpact();
                setActiveTab('chapters');
              }}
            >
              <IconSymbol
                name="book.fill"
                size={16}
                color={activeTab === 'chapters' ? '#FFFFFF' : colors.textSecondary}
              />
              <Text
                style={[
                  styles.tabButtonText,
                  { color: activeTab === 'chapters' ? '#FFFFFF' : colors.textSecondary },
                ]}
              >
                Topics
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === 'references' && { backgroundColor: colors.primary },
              ]}
              onPress={() => {
                selectionImpact();
                setActiveTab('references');
              }}
            >
              <IconSymbol
                name="doc.text.fill"
                size={16}
                color={activeTab === 'references' ? '#FFFFFF' : colors.textSecondary}
              />
              <Text
                style={[
                  styles.tabButtonText,
                  { color: activeTab === 'references' ? '#FFFFFF' : colors.textSecondary },
                ]}
              >
                References
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === 'history' && { backgroundColor: colors.primary },
              ]}
              onPress={() => {
                selectionImpact();
                setActiveTab('history');
                loadHistory();
              }}
            >
              <IconSymbol
                name="clock.arrow.circlepath"
                size={16}
                color={activeTab === 'history' ? '#FFFFFF' : colors.textSecondary}
              />
              <Text
                style={[
                  styles.tabButtonText,
                  { color: activeTab === 'history' ? '#FFFFFF' : colors.textSecondary },
                ]}
              >
                History
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === 'enrollments' && { backgroundColor: colors.primary },
              ]}
              onPress={() => {
                selectionImpact();
                setActiveTab('enrollments');
                loadEnrollments();
              }}
            >
              <IconSymbol
                name="person.badge.plus"
                size={16}
                color={activeTab === 'enrollments' ? '#FFFFFF' : colors.textSecondary}
              />
              <Text
                style={[
                  styles.tabButtonText,
                  { color: activeTab === 'enrollments' ? '#FFFFFF' : colors.textSecondary },
                ]}
              >
                Enroll{pendingEnrollments.length > 0 ? ` (${pendingEnrollments.length})` : ''}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Chapters Section */}
          {activeTab === 'chapters' && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                  TOPICS ({topics.length})
                </Text>
                <View style={styles.sectionActions}>
                  <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: '#34C759' + '20' }]}
                    onPress={() => {
                      mediumImpact();
                      handleExtractChaptersFromSyllabus();
                    }}
                    disabled={isExtractingChapters}
                  >
                    <IconSymbol name="doc.text.magnifyingglass" size={14} color="#34C759" />
                    <Text style={[styles.addButtonText, { color: '#34C759' }]}>Import</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: colors.primary + '15' }]}
                    onPress={() => {
                      mediumImpact();
                      setShowAddTopicModal(true);
                    }}
                  >
                    <IconSymbol name="plus" size={16} color={colors.primary} />
                    <Text style={[styles.addButtonText, { color: colors.primary }]}>Add</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: '#AF52DE' + '20' }]}
                    onPress={async () => {
                      mediumImpact();
                      setIsGeneratingContent(true);

                      let genCount = 0;
                      let skipCount = 0;
                      let errorCount = 0;

                      for (let i = 0; i < topics.length; i++) {
                        const topic = topics[i];
                        if (topic.has_syllabus && topic.syllabus_content && topic.syllabus_content.length > 100) {
                          skipCount++;
                          continue;
                        }

                        setGenerationStatus(`Generating topic ${i + 1} of ${topics.length}: ${topic.name}...`);
                        try {
                          await generateTopicContent(id!, topic.id);
                          genCount++;
                        } catch (err) {
                          console.error(`Failed to generate content for ${topic.name}:`, err);
                          errorCount++;
                        }
                      }

                      setGenerationStatus(`✅ Generated: ${genCount} | Skipped: ${skipCount} | Failed: ${errorCount}`);
                      if (genCount > 0) showSuccess(`Learning content generated for ${genCount} topics`);
                      else if (errorCount > 0) showError(`Failed to generate content for ${errorCount} topics`);

                      loadData();
                      setTimeout(() => setGenerationStatus(''), 5000);
                      setIsGeneratingContent(false);
                    }}
                    disabled={isGeneratingContent || topics.length === 0}
                  >
                    {isGeneratingContent ? (
                      <ActivityIndicator size="small" color="#AF52DE" />
                    ) : (
                      <IconSymbol name="sparkles" size={14} color="#AF52DE" />
                    )}
                    <Text style={[styles.addButtonText, { color: '#AF52DE' }]}>Generate</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* AI Extraction Progress */}
              {isExtractingChapters && (
                <View style={[styles.extractionProgress, { backgroundColor: colors.card }]}>
                  <ActivityIndicator size="small" color="#34C759" />
                  <Text style={[styles.extractionText, { color: colors.text }]}>
                    {extractionStatus || 'Processing...'}
                  </Text>
                  <Text style={[styles.extractionHint, { color: colors.textSecondary }]}>
                    AI is reading your syllabus and identifying topics...
                  </Text>
                </View>
              )}

              {/* LLM Content Generation Progress */}
              {(isGeneratingContent || generationStatus) && (
                <View style={[styles.extractionProgress, { backgroundColor: colors.card, borderLeftColor: '#AF52DE', borderLeftWidth: 3 }]}>
                  {isGeneratingContent && <ActivityIndicator size="small" color="#AF52DE" />}
                  <Text style={[styles.extractionText, { color: colors.text }]}>
                    {generationStatus || 'Generating learning content with AI...'}
                  </Text>
                  {isGeneratingContent && (
                    <Text style={[styles.extractionHint, { color: colors.textSecondary }]}>
                      This may take a few minutes for all topics...
                    </Text>
                  )}
                </View>
              )}

              {topics.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                  <IconSymbol name="book.closed" size={48} color={colors.textTertiary} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No Topics Yet</Text>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    Add Topics to organize your syllabus and enable question generation.
                  </Text>
                </View>
              ) : (
                <View style={[styles.topicsList, { backgroundColor: colors.card }]}>
                  {topics.map((topic, index) => (
                    <View
                      key={topic.id}
                      style={[
                        styles.topicCard,
                        index < topics.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                      ]}
                    >
                      {/* Left side: tappable chapter info */}
                      <TouchableOpacity
                        style={styles.topicCardLeft}
                        onPress={() => handleTopicPress(topic)}
                        onLongPress={() => handleDeleteTopic(topic)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.topicIndex, { backgroundColor: getTopicColor(index) + '20' }]}>
                          <Text style={[styles.topicIndexText, { color: getTopicColor(index) }]}>
                            {index + 1}
                          </Text>
                        </View>
                        <View style={styles.topicInfo}>
                          <Text style={[styles.topicName, { color: colors.text }]} numberOfLines={2}>{topic.name}</Text>
                          <View style={styles.topicMeta}>
                            {topic.has_syllabus && (
                              <View style={[styles.badge, { backgroundColor: '#34C75920' }]}>
                                <IconSymbol name="checkmark.circle.fill" size={12} color="#34C759" />
                                <Text style={[styles.badgeText, { color: '#34C759' }]}>Syllabus</Text>
                              </View>
                            )}
                            <View style={[styles.badge, { backgroundColor: colors.primary + '20' }]}>
                              <IconSymbol name="questionmark.circle" size={12} color={colors.primary} />
                              <Text style={[styles.badgeText, { color: colors.primary }]}>
                                {topic.total_questions} Q&apos;s
                              </Text>
                            </View>
                          </View>
                        </View>
                        <IconSymbol name="chevron.right" size={14} color={colors.textTertiary} />
                      </TouchableOpacity>

                      {/* Right side: generate buttons */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <TouchableOpacity
                          style={[styles.topicGenerateButton, { backgroundColor: '#AF52DE' + '12', paddingHorizontal: 8 }]}
                          onPress={async () => {
                            mediumImpact();
                            setGeneratingContentTopicId(topic.id);
                            try {
                              await generateTopicContent(id!, topic.id);
                              showSuccess(`Content generated for ${topic.name}`);
                              loadData();
                            } catch (err: any) {
                              showError(err?.response?.data?.detail || 'Content generation failed');
                            } finally {
                              setGeneratingContentTopicId(null);
                            }
                          }}
                          disabled={generatingContentTopicId === topic.id}
                          activeOpacity={0.7}
                        >
                          {generatingContentTopicId === topic.id ? (
                            <ActivityIndicator size="small" color="#AF52DE" />
                          ) : (
                            <IconSymbol name="doc.text" size={16} color="#AF52DE" />
                          )}
                          <Text style={[styles.topicGenerateLabel, { color: '#AF52DE', fontSize: 11 }]}>Content</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.topicGenerateButton, { backgroundColor: colors.primary + '12' }]}
                          onPress={() => openGenerateModal(topic)}
                          activeOpacity={0.7}
                        >
                          <IconSymbol name="sparkles" size={18} color={colors.primary} />
                          <Text style={[styles.topicGenerateLabel, { color: colors.primary }]}>Generate</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Reference Materials Section */}
          {activeTab === 'references' && (
            <View style={styles.section}>
              <ReferenceMaterials
                subjectId={id!}
                referenceBooks={referenceBooks}
                templatePapers={templatePapers}
                referenceQuestions={referenceQuestions}
                onRefresh={loadReferences}
                isLoading={isLoadingReferences}
              />
            </View>
          )}

          {/* History Section */}
          {activeTab === 'history' && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                GENERATION HISTORY
              </Text>
              {isLoadingHistory ? (
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <ActivityIndicator size="large" color={colors.primary} />
                </View>
              ) : historySessions.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                  <IconSymbol name="clock.arrow.circlepath" size={48} color={colors.textTertiary} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No History Yet</Text>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    Generation sessions for this subject will appear here.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: Spacing.sm }}>
                  {historySessions.map((session) => {
                    const methodColors: Record<string, string> = {
                      quick: '#007AFF', rubric: '#AF52DE', chapter: '#34C759', import: '#FF9500',
                    };
                    const methodLabels: Record<string, string> = {
                      quick: 'Quick', rubric: 'Rubric', chapter: 'Chapter-wise', import: 'Import',
                    };
                    const mColor = methodColors[session.generation_method || ''] || '#8E8E93';
                    const mLabel = methodLabels[session.generation_method || ''] || 'Generated';
                    const time = session.started_at
                      ? new Date(session.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : '';

                    return (
                      <View
                        key={session.id}
                        style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <View style={[styles.historyBadge, { backgroundColor: mColor + '20' }]}>
                            <Text style={{ fontSize: FontSizes.xs, fontWeight: '600', color: mColor }}>{mLabel}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                            <Text style={{ fontSize: FontSizes.xs, color: colors.textTertiary }}>{time}</Text>
                            <TouchableOpacity
                              onPress={() => handleDeleteHistorySession(session)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              style={{
                                padding: 4,
                                backgroundColor: '#FF3B3015',
                                borderRadius: BorderRadius.sm,
                              }}
                            >
                              <IconSymbol name="trash" size={14} color="#FF3B30" />
                            </TouchableOpacity>
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 12 }}>
                          <Text style={{ fontSize: FontSizes.lg, fontWeight: '700', color: colors.primary }}>
                            {session.questions_generated}
                          </Text>
                          <Text style={{ fontSize: FontSizes.sm, color: colors.textSecondary }}>questions</Text>
                          {session.generation_config?.source_file ? (
                            <Text style={{ fontSize: FontSizes.xs, color: colors.textTertiary, flex: 1 }} numberOfLines={1}>
                              {'📄 ' + String(session.generation_config.source_file)}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* Enrollment Requests Section */}
          {activeTab === 'enrollments' && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                PENDING REQUESTS ({pendingEnrollments.length})
              </Text>
              {isLoadingEnrollments ? (
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <ActivityIndicator size="large" color={colors.primary} />
                </View>
              ) : pendingEnrollments.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                  <IconSymbol name="person.badge.plus" size={48} color={colors.textTertiary} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No Pending Requests</Text>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    Students who request enrollment in this subject will appear here.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: Spacing.sm }}>
                  {pendingEnrollments.map((enrollment) => (
                    <View
                      key={enrollment.id}
                      style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: FontSizes.md, fontWeight: '600', color: colors.text }}>
                            {enrollment.student_name || 'Unknown Student'}
                          </Text>
                          <Text style={{ fontSize: FontSizes.xs, color: colors.textSecondary, marginTop: 2 }}>
                            {enrollment.student_email}
                          </Text>
                          <Text style={{ fontSize: FontSizes.xs, color: colors.textTertiary, marginTop: 2 }}>
                            Requested {new Date(enrollment.enrolled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm }}>
                        <TouchableOpacity
                          style={{
                            flex: 1,
                            backgroundColor: '#34C75920',
                            paddingVertical: Spacing.sm,
                            borderRadius: BorderRadius.md,
                            alignItems: 'center',
                          }}
                          onPress={() => handleApproveEnrollment(enrollment.id)}
                          disabled={processingEnrollmentId === enrollment.id}
                        >
                          {processingEnrollmentId === enrollment.id ? (
                            <ActivityIndicator size="small" color="#34C759" />
                          ) : (
                            <Text style={{ color: '#34C759', fontWeight: '700', fontSize: FontSizes.sm }}>
                              ✅ Approve
                            </Text>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{
                            flex: 1,
                            backgroundColor: '#FF3B3020',
                            paddingVertical: Spacing.sm,
                            borderRadius: BorderRadius.md,
                            alignItems: 'center',
                          }}
                          onPress={() => handleRejectEnrollment(enrollment.id)}
                          disabled={processingEnrollmentId === enrollment.id}
                        >
                          <Text style={{ color: '#FF3B30', fontWeight: '700', fontSize: FontSizes.sm }}>
                            ❌ Reject
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Approved Students */}
              <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: Spacing.lg }]}>
                ENROLLED STUDENTS ({approvedStudents.length})
              </Text>
              {approvedStudents.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                  <IconSymbol name="person.2.fill" size={40} color={colors.textTertiary} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No Students Yet</Text>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    Students will appear here after their enrollment is approved.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: Spacing.sm }}>
                  {approvedStudents.map((student) => (
                    <View
                      key={student.id}
                      style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: FontSizes.md, fontWeight: '600', color: colors.text }}>
                            {student.student_name || 'Unknown Student'}
                          </Text>
                          <Text style={{ fontSize: FontSizes.xs, color: colors.textSecondary, marginTop: 2 }}>
                            {student.student_email}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={{
                            backgroundColor: '#FF3B3015',
                            paddingHorizontal: Spacing.md,
                            paddingVertical: 6,
                            borderRadius: BorderRadius.md,
                            borderWidth: 1,
                            borderColor: '#FF3B3030',
                          }}
                          onPress={() => {
                            Alert.alert(
                              'Revoke Access',
                              `Remove ${student.student_name} from this subject?`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Revoke', style: 'destructive', onPress: async () => {
                                    setProcessingEnrollmentId(student.id);
                                    try {
                                      await subjectsService.rejectEnrollment(id, student.id);
                                      showSuccess('Student access revoked');
                                      await loadEnrollments();
                                    } catch (error) {
                                      showError(error, 'Failed to revoke');
                                    } finally {
                                      setProcessingEnrollmentId(null);
                                    }
                                  }
                                },
                              ]
                            );
                          }}
                          disabled={processingEnrollmentId === student.id}
                        >
                          {processingEnrollmentId === student.id ? (
                            <ActivityIndicator size="small" color="#FF3B30" />
                          ) : (
                            <Text style={{ color: '#FF3B30', fontWeight: '600', fontSize: FontSizes.xs }}>Revoke</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Learning Outcomes (if any) */}
          {activeTab === 'chapters' && subject.learning_outcomes?.outcomes && subject.learning_outcomes.outcomes.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                LEARNING OUTCOMES
              </Text>
              <View style={[styles.loList, { backgroundColor: colors.card }]}>
                {subject.learning_outcomes.outcomes.map((lo, index) => (
                  <View
                    key={lo.id}
                    style={[
                      styles.loItem,
                      index < subject.learning_outcomes!.outcomes.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                    ]}
                  >
                    <View style={[styles.loBadge, { backgroundColor: getTopicColor(index) }]}>
                      <Text style={styles.loBadgeText}>{lo.id}</Text>
                    </View>
                    <View style={styles.loContent}>
                      <Text style={[styles.loName, { color: colors.text }]}>{lo.name}</Text>
                      {lo.description && (
                        <Text style={[styles.loDescription, { color: colors.textSecondary }]}>
                          {lo.description}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        {/* Edit Subject Modal */}
        <Modal
          visible={showEditSubjectModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowEditSubjectModal(false)}
        >
          <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
            <View style={[styles.modalHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => {
                mediumImpact();
                setShowEditSubjectModal(false);
              }}>
                <Text style={[styles.modalCancel, { color: colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Subject</Text>
              <TouchableOpacity onPress={handleEditSubject} disabled={isSavingSubject}>
                {isSavingSubject ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.modalDone, { color: colors.primary }]}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalContent}>
              <View style={[styles.formSection, { backgroundColor: colors.card }]}>
                <Text style={[styles.formLabel, { color: colors.textSecondary }]}>SUBJECT CODE *</Text>
                <TextInput
                  style={[styles.textInput, { color: colors.text, borderColor: colors.border }]}
                  placeholder="e.g., CS101"
                  placeholderTextColor={colors.textTertiary}
                  value={editSubjectCode}
                  onChangeText={setEditSubjectCode}
                  autoCapitalize="characters"
                />

                <Text style={[styles.formLabel, { color: colors.textSecondary, marginTop: Spacing.md }]}>SUBJECT NAME *</Text>
                <TextInput
                  style={[styles.textInput, { color: colors.text, borderColor: colors.border }]}
                  placeholder="e.g., Introduction to Computer Science"
                  placeholderTextColor={colors.textTertiary}
                  value={editSubjectName}
                  onChangeText={setEditSubjectName}
                />

                <Text style={[styles.formLabel, { color: colors.textSecondary, marginTop: Spacing.md }]}>
                  DESCRIPTION (OPTIONAL)
                </Text>
                <TextInput
                  style={[styles.textArea, { color: colors.text, borderColor: colors.border }]}
                  placeholder="Brief description of the subject..."
                  placeholderTextColor={colors.textTertiary}
                  value={editSubjectDescription}
                  onChangeText={setEditSubjectDescription}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>
            </ScrollView>
          </View>
        </Modal>

        {/* Add Topic Modal */}
        <Modal
          visible={showAddTopicModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowAddTopicModal(false)}
        >
          <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
            <View style={[styles.modalHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => {
                mediumImpact();
                setShowAddTopicModal(false);
              }}>
                <Text style={[styles.modalCancel, { color: colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Add Chapter</Text>
              <TouchableOpacity onPress={handleCreateTopic} disabled={isCreatingTopic}>
                {isCreatingTopic ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.modalDone, { color: colors.primary }]}>Add</Text>
                )}
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalContent}>
              <View style={[styles.formSection, { backgroundColor: colors.card }]}>
                <Text style={[styles.formLabel, { color: colors.textSecondary }]}>CHAPTER NAME *</Text>
                <TextInput
                  style={[styles.textInput, { color: colors.text, borderColor: colors.border }]}
                  placeholder="e.g., Introduction to Data Structures"
                  placeholderTextColor={colors.textTertiary}
                  value={newTopicName}
                  onChangeText={setNewTopicName}
                  autoFocus
                />
                <Text style={[styles.formLabel, { color: colors.textSecondary, marginTop: Spacing.md }]}>
                  DESCRIPTION (OPTIONAL)
                </Text>
                <TextInput
                  style={[styles.textAreaInput, { color: colors.text, borderColor: colors.border }]}
                  placeholder="Brief description of this chapter..."
                  placeholderTextColor={colors.textTertiary}
                  value={newTopicDescription}
                  onChangeText={setNewTopicDescription}
                  multiline
                  numberOfLines={3}
                />
              </View>
            </ScrollView>
          </View>
        </Modal>

        {/* Topic Detail Modal */}
        <Modal
          visible={showTopicDetailModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowTopicDetailModal(false)}
        >
          <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
            <View style={[styles.modalHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => {
                mediumImpact();
                setShowTopicDetailModal(false);
              }}>
                <Text style={[styles.modalCancel, { color: colors.primary }]}>Close</Text>
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
                {selectedTopic?.name}
              </Text>
              <TouchableOpacity onPress={handleSaveSyllabus}>
                <Text style={[styles.modalDone, { color: colors.primary }]}>Save</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalContent}>
              {/* Upload Document */}
              <View style={[styles.formSection, { backgroundColor: colors.card }]}>
                <Text style={[styles.formLabel, { color: colors.textSecondary }]}>UPLOAD SYLLABUS/NOTES</Text>
                <TouchableOpacity
                  style={[
                    styles.uploadButton,
                    { borderColor: isUploadingDoc ? colors.textTertiary : colors.primary },
                    isUploadingDoc && { backgroundColor: colors.background }
                  ]}
                  onPress={handleUploadSyllabus}
                  disabled={isUploadingDoc}
                >
                  {isUploadingDoc ? (
                    <View style={styles.uploadProgressContainer}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={[styles.uploadStatusText, { color: colors.primary }]}>
                        {uploadStatus || 'Processing...'}
                      </Text>
                    </View>
                  ) : (
                    <>
                      <IconSymbol name="doc.badge.plus" size={24} color={colors.primary} />
                      <Text style={[styles.uploadButtonText, { color: colors.primary }]}>
                        Upload PDF, DOCX, or TXT
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
                {isUploadingDoc && (
                  <Text style={[styles.formHint, { color: colors.textSecondary, marginTop: Spacing.sm }]}>
                    This may take a minute for large documents...
                  </Text>
                )}
                <Text style={[styles.formHint, { color: colors.textTertiary }]}>
                  Documents will be processed and used for question generation
                </Text>
              </View>

              {/* Manual Syllabus Content */}
              <View style={[styles.formSection, { backgroundColor: colors.card }]}>
                <Text style={[styles.formLabel, { color: colors.textSecondary }]}>
                  OR PASTE SYLLABUS CONTENT
                </Text>
                <TextInput
                  style={[styles.syllabusInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                  placeholder="Paste your syllabus content here..."
                  placeholderTextColor={colors.textTertiary}
                  value={syllabusContent}
                  onChangeText={setSyllabusContent}
                  multiline
                  numberOfLines={10}
                  textAlignVertical="top"
                />
              </View>

              {/* Topic Stats */}
              {selectedTopic && (
                <View style={[styles.formSection, { backgroundColor: colors.card }]}>
                  <Text style={[styles.formLabel, { color: colors.textSecondary }]}>STATISTICS</Text>
                  <View style={styles.topicStatsRow}>
                    <View style={styles.topicStatItem}>
                      <Text style={[styles.topicStatValue, { color: colors.text }]}>
                        {selectedTopic.total_questions}
                      </Text>
                      <Text style={[styles.topicStatLabel, { color: colors.textSecondary }]}>
                        Questions
                      </Text>
                    </View>
                    <View style={styles.topicStatItem}>
                      <Text style={[styles.topicStatValue, { color: colors.text }]}>
                        {selectedTopic.has_syllabus ? 'Yes' : 'No'}
                      </Text>
                      <Text style={[styles.topicStatLabel, { color: colors.textSecondary }]}>
                        Has Content
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </Modal>

        {/* Chapter Generation Modal */}
        <Modal
          visible={showGenerateModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={closeGenerateModal}
        >
          <View style={[styles.genModalContainer, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.genModalHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={closeGenerateModal} style={{ minWidth: 60 }}>
                <Text style={{ color: colors.primary, fontSize: FontSizes.md }}>
                  {isGenerating ? 'Cancel' : 'Close'}
                </Text>
              </TouchableOpacity>
              <Text style={[styles.genModalTitle, { color: colors.text }]} numberOfLines={1}>
                {generateTopic?.name || 'Generate'}
              </Text>
              <View style={{ minWidth: 60 }} />
            </View>

            {/* Generation in progress */}
            {isGenerating || genProgress?.status === 'complete' ? (
              <ScrollView contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.lg }}>
                {/* Progress bar */}
                <View style={[styles.genSection, { backgroundColor: colors.card }]}>
                  <Text style={[styles.genSectionLabel, { color: colors.textSecondary }]}>PROGRESS</Text>
                  <View style={[styles.genProgressBarBg, { backgroundColor: colors.border }]}>
                    <Animated.View
                      style={[
                        styles.genProgressBarFill,
                        {
                          backgroundColor: colors.primary,
                          width: genProgressAnim.interpolate({
                            inputRange: [0, 100],
                            outputRange: ['0%', '100%'],
                          }),
                        },
                      ]}
                    />
                  </View>
                  {genProgress && (
                    <Text style={[styles.genProgressText, { color: colors.text }]}>
                      {genProgress.message}
                    </Text>
                  )}
                  {genProgress != null && genProgress.current_question != null && genProgress.total_questions != null && genProgress.total_questions > 0 && (
                    <Text style={{ color: colors.textSecondary, fontSize: FontSizes.xs, marginTop: 4 }}>
                      {genProgress.current_question} / {genProgress.total_questions} questions
                    </Text>
                  )}
                </View>

                {/* Generated questions preview */}
                {genQuestions.length > 0 && (
                  <View style={[styles.genSection, { backgroundColor: colors.card }]}>
                    <Text style={[styles.genSectionLabel, { color: colors.textSecondary }]}>
                      GENERATED ({genQuestions.length})
                    </Text>
                    {genQuestions.slice(-5).map((q, idx) => (
                      <View key={q.id} style={[styles.genQuestionRow, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                        <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
                          <View style={[styles.genQTypeBadge, { backgroundColor: colors.primary + '15' }]}>
                            <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '700' }}>
                              {q.question_type.toUpperCase()}
                            </Text>
                          </View>
                          {q.learning_outcome_id && (
                            <View style={[styles.genQTypeBadge, { backgroundColor: '#34C75915' }]}>
                              <Text style={{ color: '#34C759', fontSize: 10, fontWeight: '700' }}>
                                {q.learning_outcome_id}
                              </Text>
                            </View>
                          )}
                          {q.course_outcome_mapping && Object.keys(q.course_outcome_mapping).length > 0 && (
                            <View style={[styles.genQTypeBadge, { backgroundColor: '#FF950015' }]}>
                              <Text style={{ color: '#FF9500', fontSize: 10, fontWeight: '700' }}>
                                {Object.keys(q.course_outcome_mapping).join(', ')}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ color: colors.text, fontSize: FontSizes.sm, flex: 1 }} numberOfLines={2}>
                          {q.question_text}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Completion */}
                {genProgress?.status === 'complete' && (
                  <View style={[styles.genSection, { backgroundColor: '#E8F5E9' }]}>
                    <View style={{ alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md }}>
                      <IconSymbol name="checkmark.circle.fill" size={36} color="#34C759" />
                      <Text style={{ fontSize: FontSizes.lg, fontWeight: '700', color: '#1B5E20' }}>
                        Generation Complete!
                      </Text>
                      <Text style={{ fontSize: FontSizes.sm, color: '#2E7D32' }}>
                        {genQuestions.length} questions generated and ready for vetting.
                      </Text>
                      <TouchableOpacity
                        style={[styles.genDoneButton, { backgroundColor: '#34C759' }]}
                        onPress={() => {
                          closeGenerateModal();
                          router.push('/(tabs)/home/vetting');
                        }}
                      >
                        <Text style={{ color: '#FFF', fontWeight: '700', fontSize: FontSizes.sm }}>View & Vet Questions</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </ScrollView>
            ) : (
              /* Tab picker: Quick Generate or Use Existing */
              <>
                <View style={[styles.genTabBar, { backgroundColor: colors.card }]}>
                  <TouchableOpacity
                    style={[styles.genTab, genTab === 'quick' && { backgroundColor: colors.primary }]}
                    onPress={() => setGenTab('quick')}
                  >
                    <IconSymbol name="sparkles" size={14} color={genTab === 'quick' ? '#FFF' : colors.textSecondary} />
                    <Text style={[styles.genTabText, { color: genTab === 'quick' ? '#FFF' : colors.textSecondary }]}>Quick Generate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.genTab, genTab === 'existing' && { backgroundColor: colors.primary }]}
                    onPress={() => setGenTab('existing')}
                  >
                    <IconSymbol name="doc.fill" size={14} color={genTab === 'existing' ? '#FFF' : colors.textSecondary} />
                    <Text style={[styles.genTabText, { color: genTab === 'existing' ? '#FFF' : colors.textSecondary }]}>Use Existing Rubric</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.md }}>
                  {genTab === 'quick' ? (
                    /* Quick Generate Form */
                    <>
                      <View style={[styles.genSection, { backgroundColor: colors.card }]}>
                        <Text style={[styles.genSectionLabel, { color: colors.textSecondary }]}>QUESTION TYPES & MARKS</Text>
                        <Text style={{ color: colors.textTertiary, fontSize: FontSizes.xs, marginBottom: Spacing.md }}>
                          Set count and marks per question type. No limits.
                        </Text>

                        {/* MCQ */}
                        <View style={styles.genCountRow}>
                          <View style={[styles.genCountIcon, { backgroundColor: '#007AFF20' }]}>
                            <IconSymbol name="list.bullet" size={16} color="#007AFF" />
                          </View>
                          <Text style={[styles.genCountLabel, { color: colors.text }]}>MCQ</Text>
                          <View style={styles.genCountControls}>
                            <TouchableOpacity style={[styles.genCountBtn, { borderColor: colors.border }]} onPress={() => setQgMcqCount(String(Math.max(0, (parseInt(qgMcqCount) || 0) - 1)))}>
                              <Text style={{ color: colors.text, fontWeight: '700' }}>−</Text>
                            </TouchableOpacity>
                            <TextInput style={[styles.genCountInput, { color: colors.text, borderColor: colors.border }]} value={qgMcqCount} onChangeText={setQgMcqCount} keyboardType="number-pad" />
                            <TouchableOpacity style={[styles.genCountBtn, { borderColor: colors.border }]} onPress={() => setQgMcqCount(String((parseInt(qgMcqCount) || 0) + 1))}>
                              <Text style={{ color: colors.text, fontWeight: '700' }}>+</Text>
                            </TouchableOpacity>
                            <Text style={{ color: colors.textSecondary, fontSize: FontSizes.xs, marginLeft: 8 }}>Marks:</Text>
                            <TextInput style={[styles.genCountInput, { color: colors.text, borderColor: colors.border, width: 40 }]} value={qgMcqMarks} onChangeText={setQgMcqMarks} keyboardType="number-pad" />
                          </View>
                        </View>

                        {/* Short Answer */}
                        <View style={styles.genCountRow}>
                          <View style={[styles.genCountIcon, { backgroundColor: '#34C75920' }]}>
                            <IconSymbol name="pencil" size={16} color="#34C759" />
                          </View>
                          <Text style={[styles.genCountLabel, { color: colors.text }]}>Short Answer</Text>
                          <View style={styles.genCountControls}>
                            <TouchableOpacity style={[styles.genCountBtn, { borderColor: colors.border }]} onPress={() => setQgShortCount(String(Math.max(0, (parseInt(qgShortCount) || 0) - 1)))}>
                              <Text style={{ color: colors.text, fontWeight: '700' }}>−</Text>
                            </TouchableOpacity>
                            <TextInput style={[styles.genCountInput, { color: colors.text, borderColor: colors.border }]} value={qgShortCount} onChangeText={setQgShortCount} keyboardType="number-pad" />
                            <TouchableOpacity style={[styles.genCountBtn, { borderColor: colors.border }]} onPress={() => setQgShortCount(String((parseInt(qgShortCount) || 0) + 1))}>
                              <Text style={{ color: colors.text, fontWeight: '700' }}>+</Text>
                            </TouchableOpacity>
                            <Text style={{ color: colors.textSecondary, fontSize: FontSizes.xs, marginLeft: 8 }}>Marks:</Text>
                            <TextInput style={[styles.genCountInput, { color: colors.text, borderColor: colors.border, width: 40 }]} value={qgShortMarks} onChangeText={setQgShortMarks} keyboardType="number-pad" />
                          </View>
                        </View>

                        {/* Long Answer */}
                        <View style={styles.genCountRow}>
                          <View style={[styles.genCountIcon, { backgroundColor: '#FF950020' }]}>
                            <IconSymbol name="doc.richtext" size={16} color="#FF9500" />
                          </View>
                          <Text style={[styles.genCountLabel, { color: colors.text }]}>Long Answer</Text>
                          <View style={styles.genCountControls}>
                            <TouchableOpacity style={[styles.genCountBtn, { borderColor: colors.border }]} onPress={() => setQgLongCount(String(Math.max(0, (parseInt(qgLongCount) || 0) - 1)))}>
                              <Text style={{ color: colors.text, fontWeight: '700' }}>−</Text>
                            </TouchableOpacity>
                            <TextInput style={[styles.genCountInput, { color: colors.text, borderColor: colors.border }]} value={qgLongCount} onChangeText={setQgLongCount} keyboardType="number-pad" />
                            <TouchableOpacity style={[styles.genCountBtn, { borderColor: colors.border }]} onPress={() => setQgLongCount(String((parseInt(qgLongCount) || 0) + 1))}>
                              <Text style={{ color: colors.text, fontWeight: '700' }}>+</Text>
                            </TouchableOpacity>
                            <Text style={{ color: colors.textSecondary, fontSize: FontSizes.xs, marginLeft: 8 }}>Marks:</Text>
                            <TextInput style={[styles.genCountInput, { color: colors.text, borderColor: colors.border, width: 40 }]} value={qgLongMarks} onChangeText={setQgLongMarks} keyboardType="number-pad" />
                          </View>
                        </View>
                      </View>

                      <TouchableOpacity
                        style={[styles.genStartButton, { backgroundColor: colors.primary }]}
                        onPress={handleQuickGenerate}
                      >
                        <IconSymbol name="sparkles" size={18} color="#FFF" />
                        <Text style={{ color: '#FFF', fontWeight: '700', fontSize: FontSizes.md }}>Generate Questions</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    /* Existing Rubrics List */
                    <View style={[styles.genSection, { backgroundColor: colors.card }]}>
                      <Text style={[styles.genSectionLabel, { color: colors.textSecondary }]}>SELECT A RUBRIC</Text>
                      {isLoadingRubrics ? (
                        <ActivityIndicator color={colors.primary} style={{ paddingVertical: Spacing.xl }} />
                      ) : existingRubrics.length === 0 ? (
                        <View style={{ alignItems: 'center', paddingVertical: Spacing.xl }}>
                          <IconSymbol name="doc" size={36} color={colors.textTertiary} />
                          <Text style={{ color: colors.textSecondary, marginTop: Spacing.sm, fontSize: FontSizes.sm }}>
                            No rubrics for this subject yet.
                          </Text>
                          <Text style={{ color: colors.textTertiary, fontSize: FontSizes.xs, marginTop: 4 }}>
                            Use Quick Generate or create a rubric first.
                          </Text>
                        </View>
                      ) : (
                        existingRubrics.map((rubric, idx) => (
                          <TouchableOpacity
                            key={rubric.id}
                            style={[styles.genRubricRow, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                            onPress={() => handleUseExistingRubric(rubric)}
                            activeOpacity={0.7}
                          >
                            <View style={[styles.genRubricIcon, { backgroundColor: colors.primary + '15' }]}>
                              <IconSymbol name="doc.fill" size={18} color={colors.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: colors.text, fontWeight: '600', fontSize: FontSizes.sm }}>{rubric.name}</Text>
                              <Text style={{ color: colors.textSecondary, fontSize: FontSizes.xs }}>
                                {rubric.total_questions} Q · {rubric.total_marks} marks · {rubric.duration_minutes}m
                              </Text>
                            </View>
                            <IconSymbol name="play.circle.fill" size={28} color={colors.primary} />
                          </TouchableOpacity>
                        ))
                      )}
                    </View>
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </Modal>

        {/* Export Modal */}
        <ExportModal
          visible={showExportModal}
          onClose={() => setShowExportModal(false)}
          questions={exportQuestions}
          defaultFilename={subject?.code ? `${subject.code}_questions` : 'questions'}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  errorText: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  backButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  scrollContent: {
    paddingTop: Spacing.headerInset,
    paddingBottom: Spacing.xxl,
  },
  headerCard: {
    margin: Spacing.md,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  headerContent: {
    marginBottom: Spacing.md,
  },
  subjectCode: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  subjectName: {
    fontSize: FontSizes.xxl,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: Spacing.xs,
  },
  subjectDescription: {
    fontSize: FontSizes.sm,
    color: 'rgba(255,255,255,0.8)',
    marginTop: Spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: FontSizes.xs,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: FontSizes.sm,
  },
  tabSelector: {
    flexDirection: 'row',
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.md,
    padding: 4,
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
  section: {
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  sectionActions: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  sectionTitle: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
    letterSpacing: 0.5,
    paddingBottom: Spacing.md,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    gap: 4,
  },
  addButtonText: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  extractionProgress: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  extractionText: {
    fontSize: FontSizes.md,
    fontWeight: '600',
    textAlign: 'center',
  },
  extractionHint: {
    fontSize: FontSizes.sm,
    textAlign: 'center',
  },
  emptyCard: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
    marginTop: Spacing.md,
  },
  emptyText: {
    fontSize: FontSizes.sm,
    textAlign: 'center',
    marginTop: Spacing.xs,
    lineHeight: 20,
  },
  topicsList: {
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  topicCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  topicCardLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  topicGenerateButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    gap: 2,
    minWidth: 60,
  },
  topicGenerateLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  topicIndex: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  topicIndexText: {
    fontSize: FontSizes.md,
    fontWeight: '700',
  },
  topicInfo: {
    flex: 1,
  },
  topicName: {
    fontSize: FontSizes.md,
    fontWeight: '500',
    marginBottom: 4,
  },
  topicMeta: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    gap: 4,
  },
  badgeText: {
    fontSize: FontSizes.xs,
    fontWeight: '500',
  },
  loList: {
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  loItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: Spacing.md,
  },
  loBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
    marginRight: Spacing.sm,
  },
  loBadgeText: {
    color: '#FFFFFF',
    fontSize: FontSizes.xs,
    fontWeight: '700',
  },
  loContent: {
    flex: 1,
  },
  loName: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  loDescription: {
    fontSize: FontSizes.xs,
    marginTop: 2,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  modalCancel: {
    fontSize: FontSizes.md,
  },
  modalTitle: {
    fontSize: FontSizes.md,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: Spacing.sm,
  },
  modalDone: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: Spacing.md,
  },
  formSection: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  formLabel: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  formHint: {
    fontSize: FontSizes.xs,
    marginTop: Spacing.sm,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSizes.md,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSizes.md,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  textAreaInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSizes.md,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  uploadButtonText: {
    fontSize: FontSizes.md,
    fontWeight: '500',
  },
  uploadProgressContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  uploadStatusText: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
    textAlign: 'center',
  },
  syllabusInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSizes.sm,
    minHeight: 200,
  },
  topicStatsRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  topicStatItem: {
    flex: 1,
  },
  topicStatValue: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
  },
  topicStatLabel: {
    fontSize: FontSizes.xs,
    marginTop: 2,
  },
  // ---- Generation Modal Styles ----
  genModalContainer: {
    flex: 1,
  },
  genModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  genModalTitle: {
    fontSize: FontSizes.md,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: Spacing.sm,
  },
  genTabBar: {
    flexDirection: 'row',
    margin: Spacing.md,
    borderRadius: BorderRadius.lg,
    padding: 4,
    gap: 4,
  },
  genTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    gap: 6,
  },
  genTabText: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
  },
  genSection: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  genSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginBottom: Spacing.md,
  },
  genProgressBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  genProgressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  genProgressText: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  genQuestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  genQTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  genDoneButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.sm,
  },
  genCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  genCountIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genCountLabel: {
    flex: 1,
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  genCountControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  genCountBtn: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genCountInput: {
    width: 44,
    height: 36,
    textAlign: 'center',
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  genStartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.lg,
    gap: Spacing.sm,
  },
  genRubricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  genRubricIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  historyBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
  },
});
