/**
 * Reference Materials Component
 * Allows users to upload reference books and template papers for a subject
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing, BorderRadius, FontSizes } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useToast } from '@/components/toast';
import { referencesService, ReferenceDocument, DocumentStatus } from '@/services/references';

interface ReferenceMaterialsProps {
  subjectId: string;
  referenceBooks: ReferenceDocument[];
  templatePapers: ReferenceDocument[];
  referenceQuestions: ReferenceDocument[];
  onRefresh: () => void;
  isLoading?: boolean;
}

export function ReferenceMaterials({
  subjectId,
  referenceBooks,
  templatePapers,
  referenceQuestions,
  onRefresh,
  isLoading = false,
}: ReferenceMaterialsProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { showError, showSuccess, showWarning } = useToast();

  const [isUploadingBook, setIsUploadingBook] = useState(false);
  const [isUploadingPaper, setIsUploadingPaper] = useState(false);
  const [isUploadingQuestions, setIsUploadingQuestions] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [processingStatus, setProcessingStatus] = useState<DocumentStatus | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPickingDocument, setIsPickingDocument] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // Animate progress bar
  useEffect(() => {
    const targetValue = processingStatus
      ? processingStatus.processing_progress / 100
      : uploadPercent / 100;
    Animated.timing(progressAnim, {
      toValue: targetValue,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [uploadPercent, processingStatus?.processing_progress]);

  const resetUploadState = useCallback(() => {
    setIsUploadingBook(false);
    setIsUploadingPaper(false);
    setIsUploadingQuestions(false);
    setUploadProgress('');
    setUploadPercent(0);
    setProcessingStatus(null);
    progressAnim.setValue(0);
  }, []);

  const pollProcessingStatus = useCallback(
    (documentId: string) => {
      if (pollingRef.current) clearInterval(pollingRef.current);

      pollingRef.current = setInterval(async () => {
        try {
          const status = await referencesService.getDocumentStatus(documentId);
          setProcessingStatus(status);

          if (status.status === 'completed') {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
            resetUploadState();
            showSuccess('Document processed successfully');
            onRefresh();
          } else if (status.status === 'failed') {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
            resetUploadState();
            showError(
              new Error(status.error || 'Processing failed'),
              'Processing Failed'
            );
            onRefresh();
          }
        } catch {
          // Silently retry on network blips
        }
      }, 2000);
    },
    [onRefresh, showSuccess, showError, resetUploadState]
  );

  const isAnyUploading = isUploadingBook || isUploadingPaper || isUploadingQuestions;

  const handleUploadReferenceBook = useCallback(async () => {
    if (isPickingDocument) {
      showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      return;
    }

    setIsUploadingBook(true);
    setIsPickingDocument(true);
    setUploadProgress('Selecting file...');
    setUploadPercent(0);
    progressAnim.setValue(0);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsUploadingBook(false);
        setUploadProgress('');
        setUploadPercent(0);
        return;
      }

      const file = result.assets[0];
      const fileSizeMB = file.size ? (file.size / (1024 * 1024)).toFixed(1) : '?';

      // Validate file size (max 500MB)
      if (file.size && file.size > 500 * 1024 * 1024) {
        showError(new Error('File size must be less than 500MB'), 'File Too Large');
        setIsUploadingBook(false);
        setUploadProgress('');
        setUploadPercent(0);
        return;
      }

      setUploadProgress(`Uploading ${file.name} (${fileSizeMB}MB)...`);

      const response = await referencesService.uploadReferenceBook(
        subjectId,
        file.uri,
        file.name,
        file.mimeType || 'application/pdf',
        (pct) => {
          setUploadPercent(pct);
          setUploadProgress(`Uploading ${file.name} — ${pct}%`);
        }
      );

      // Upload done, now poll for processing status
      setUploadProgress('Processing document...');
      setUploadPercent(0);

      if (response.status === 'completed') {
        showSuccess('Reference book uploaded and processed');
        onRefresh();
      } else {
        // Start polling for processing progress
        pollProcessingStatus(response.document_id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('document picking in progress') || errorMessage.includes('Different document picking')) {
        showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      } else {
        showError(error, 'Upload Failed');
      }
      setIsUploadingBook(false);
      setUploadProgress('');
      setUploadPercent(0);
      setProcessingStatus(null);
    } finally {
      setIsPickingDocument(false);
      // Only clear uploading state if not polling (polling will clear it)
      if (!pollingRef.current) {
        setIsUploadingBook(false);
        setUploadProgress('');
        setUploadPercent(0);
      }
    }
  }, [subjectId, onRefresh, showError, showSuccess, showWarning, isPickingDocument, pollProcessingStatus]);

  const handleUploadTemplatePaper = useCallback(async () => {
    if (isPickingDocument) {
      showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      return;
    }

    setIsUploadingPaper(true);
    setIsPickingDocument(true);
    setUploadProgress('Selecting file...');
    setUploadPercent(0);
    progressAnim.setValue(0);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsUploadingPaper(false);
        setUploadProgress('');
        setUploadPercent(0);
        return;
      }

      const file = result.assets[0];
      const fileSizeMB = file.size ? (file.size / (1024 * 1024)).toFixed(1) : '?';

      // Validate file size (max 500MB)
      if (file.size && file.size > 500 * 1024 * 1024) {
        showError(new Error('File size must be less than 500MB'), 'File Too Large');
        setIsUploadingPaper(false);
        setUploadProgress('');
        setUploadPercent(0);
        return;
      }

      setUploadProgress(`Uploading ${file.name} (${fileSizeMB}MB)...`);

      const response = await referencesService.uploadTemplatePaper(
        subjectId,
        file.uri,
        file.name,
        file.mimeType || 'application/pdf',
        (pct) => {
          setUploadPercent(pct);
          setUploadProgress(`Uploading ${file.name} — ${pct}%`);
        }
      );

      setUploadProgress('Processing document...');
      setUploadPercent(0);

      if (response.status === 'completed') {
        showSuccess('Template paper uploaded and processed');
        onRefresh();
      } else {
        pollProcessingStatus(response.document_id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('document picking in progress') || errorMessage.includes('Different document picking')) {
        showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      } else {
        showError(error, 'Upload Failed');
      }
      setIsUploadingPaper(false);
      setUploadProgress('');
      setUploadPercent(0);
      setProcessingStatus(null);
    } finally {
      setIsPickingDocument(false);
      if (!pollingRef.current) {
        setIsUploadingPaper(false);
        setUploadProgress('');
        setUploadPercent(0);
      }
    }
  }, [subjectId, onRefresh, showError, showSuccess, showWarning, isPickingDocument, pollProcessingStatus]);

  const handleDeleteReference = useCallback((doc: ReferenceDocument) => {
    Alert.alert(
      'Delete Reference',
      `Are you sure you want to delete "${doc.filename}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(doc.id);
            try {
              await referencesService.deleteReference(doc.id);
              showSuccess('Reference deleted');
              // Wait a moment for backend to process, then refresh
              setTimeout(() => onRefresh(), 500);
            } catch (error) {
              showError(error, 'Delete Failed');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  }, [onRefresh, showError, showSuccess]);

  const handleUploadReferenceQuestions = useCallback(async () => {
    if (isPickingDocument) {
      showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      return;
    }

    setIsUploadingQuestions(true);
    setIsPickingDocument(true);
    setUploadProgress('Selecting file...');
    setUploadPercent(0);
    progressAnim.setValue(0);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsUploadingQuestions(false);
        setUploadProgress('');
        setUploadPercent(0);
        return;
      }

      const file = result.assets[0];
      const fileSizeMB = file.size ? (file.size / (1024 * 1024)).toFixed(1) : '?';

      if (file.size && file.size > 500 * 1024 * 1024) {
        showError(new Error('File size must be less than 500MB'), 'File Too Large');
        setIsUploadingQuestions(false);
        setUploadProgress('');
        setUploadPercent(0);
        return;
      }

      setUploadProgress(`Uploading ${file.name} (${fileSizeMB}MB)...`);

      const response = await referencesService.uploadReferenceQuestions(
        subjectId,
        file.uri,
        file.name,
        file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        (pct) => {
          setUploadPercent(pct);
          setUploadProgress(`Uploading ${file.name} — ${pct}%`);
        }
      );

      if (response.status === 'completed') {
        showSuccess(response.message || 'Reference questions uploaded');
        onRefresh();
      } else {
        setUploadProgress('Processing document...');
        setUploadPercent(0);
        pollProcessingStatus(response.document_id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('document picking in progress') || errorMessage.includes('Different document picking')) {
        showWarning('Please wait for the current file selection to complete', 'File Picker Busy');
      } else {
        showError(error, 'Upload Failed');
      }
      setIsUploadingQuestions(false);
      setUploadProgress('');
      setUploadPercent(0);
      setProcessingStatus(null);
    } finally {
      setIsPickingDocument(false);
      if (!pollingRef.current) {
        setIsUploadingQuestions(false);
        setUploadProgress('');
        setUploadPercent(0);
      }
    }
  }, [subjectId, onRefresh, showError, showSuccess, showWarning, isPickingDocument, pollProcessingStatus]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return colors.success;
      case 'processing':
        return colors.warning;
      case 'failed':
        return colors.error;
      default:
        return colors.textTertiary;
    }
  };

  const renderDocumentItem = (doc: ReferenceDocument) => (
    <View
      key={doc.id}
      style={[styles.documentItem, { borderBottomColor: colors.border }]}
    >
      <View style={[styles.docIcon, { backgroundColor: colors.primary + '15' }]}>
        <IconSymbol name="doc.fill" size={20} color={colors.primary} />
      </View>
      <View style={styles.docInfo}>
        <Text style={[styles.docName, { color: colors.text }]} numberOfLines={1}>
          {doc.filename}
        </Text>
        <View style={styles.docMeta}>
          <Text style={[styles.docMetaText, { color: colors.textSecondary }]}>
            {formatDate(doc.upload_timestamp)}
          </Text>
          <View style={[styles.metaDot, { backgroundColor: colors.textTertiary }]} />
          <Text style={[styles.docMetaText, { color: colors.textSecondary }]}>
            {formatFileSize(doc.file_size_bytes)}
          </Text>
          <View style={[styles.metaDot, { backgroundColor: colors.textTertiary }]} />
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(doc.processing_status) + '20' }]}>
            <Text style={[styles.statusText, { color: getStatusColor(doc.processing_status) }]}>
              {doc.processing_status}
            </Text>
          </View>
          {doc.is_public && (
            <View style={[styles.statusBadge, { backgroundColor: '#34C759' + '20', marginLeft: 4 }]}>
              <Text style={[styles.statusText, { color: '#34C759' }]}>shared</Text>
            </View>
          )}
        </View>
      </View>
      <TouchableOpacity
        style={[styles.deleteButton, { marginRight: 8 }]}
        onPress={async () => {
          try {
            await referencesService.toggleVisibility(doc.id);
            onRefresh();
          } catch {
            Alert.alert('Error', 'Failed to toggle visibility');
          }
        }}
      >
        <IconSymbol
          name={doc.is_public ? "eye.fill" : "eye.slash.fill"}
          size={18}
          color={doc.is_public ? '#34C759' : colors.textSecondary}
        />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => handleDeleteReference(doc)}
        disabled={deletingId === doc.id}
      >
        {deletingId === doc.id ? (
          <ActivityIndicator size="small" color={colors.error} />
        ) : (
          <IconSymbol name="trash.fill" size={18} color={colors.error} />
        )}
      </TouchableOpacity>
    </View>
  );

  const renderEmptyState = (type: string) => (
    <View style={styles.emptyState}>
      <IconSymbol
        name={type === 'book' ? 'book.closed' : 'doc.text'}
        size={32}
        color={colors.textTertiary}
      />
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
        No {type === 'book' ? 'reference books' : 'template papers'} uploaded yet
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Reference Materials</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Upload reference books and sample papers to guide intelligent question generation.
        </Text>
      </View>

      {/* Upload Progress Bar */}
      {isAnyUploading && (
        <View style={[styles.progressContainer, { backgroundColor: colors.card }]}>
          <View style={styles.progressHeader}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.progressText, { color: colors.text }]}>
              {processingStatus
                ? processingStatus.processing_detail || processingStatus.processing_step || 'Processing...'
                : uploadProgress || 'Preparing...'}
            </Text>
          </View>
          <View style={[styles.progressBarTrack, { backgroundColor: colors.border }]}>
            <Animated.View
              style={[
                styles.progressBarFill,
                {
                  backgroundColor: colors.primary,
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>
          <Text style={[styles.progressPercent, { color: colors.textSecondary }]}>
            {processingStatus
              ? `${processingStatus.processing_progress}%${processingStatus.total_pages ? ` • ${processingStatus.total_pages} pages` : ''}`
              : uploadPercent > 0
                ? `${uploadPercent}%`
                : ''}
          </Text>
        </View>
      )}

      {/* Reference Books Section */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <View style={[styles.sectionIcon, { backgroundColor: '#007AFF15' }]}>
              <IconSymbol name="book.fill" size={18} color="#007AFF" />
            </View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Reference Books</Text>
          </View>
          <TouchableOpacity
            style={[
              styles.uploadButton,
              { backgroundColor: colors.primary + '15' },
              isUploadingBook && { opacity: 0.6 },
            ]}
            onPress={handleUploadReferenceBook}
            disabled={isAnyUploading}
          >
            {isUploadingBook ? (
              <>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.uploadButtonText, { color: colors.primary }]}>
                  Uploading...
                </Text>
              </>
            ) : (
              <>
                <IconSymbol name="plus.circle.fill" size={16} color={colors.primary} />
                <Text style={[styles.uploadButtonText, { color: colors.primary }]}>
                  Upload
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : referenceBooks.length === 0 ? (
          renderEmptyState('book')
        ) : (
          <View style={styles.documentList}>
            {referenceBooks.map(renderDocumentItem)}
          </View>
        )}
      </View>

      {/* Template Papers Section */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <View style={[styles.sectionIcon, { backgroundColor: '#FF950015' }]}>
              <IconSymbol name="doc.text.fill" size={18} color="#FF9500" />
            </View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Template Question Papers</Text>
          </View>
          <TouchableOpacity
            style={[
              styles.uploadButton,
              { backgroundColor: '#FF9500' + '15' },
              isUploadingPaper && { opacity: 0.6 },
            ]}
            onPress={handleUploadTemplatePaper}
            disabled={isAnyUploading}
          >
            {isUploadingPaper ? (
              <>
                <ActivityIndicator size="small" color="#FF9500" />
                <Text style={[styles.uploadButtonText, { color: '#FF9500' }]}>
                  Uploading...
                </Text>
              </>
            ) : (
              <>
                <IconSymbol name="plus.circle.fill" size={16} color="#FF9500" />
                <Text style={[styles.uploadButtonText, { color: '#FF9500' }]}>
                  Upload
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : templatePapers.length === 0 ? (
          renderEmptyState('paper')
        ) : (
          <View style={styles.documentList}>
            {templatePapers.map(renderDocumentItem)}
          </View>
        )}
      </View>

      {/* Reference Questions Section */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <View style={[styles.sectionIcon, { backgroundColor: '#34C75915' }]}>
              <IconSymbol name="doc.text.fill" size={18} color="#34C759" />
            </View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Reference Questions</Text>
          </View>
          <TouchableOpacity
            style={[
              styles.uploadButton,
              { backgroundColor: '#34C759' + '15' },
              isUploadingQuestions && { opacity: 0.6 },
            ]}
            onPress={handleUploadReferenceQuestions}
            disabled={isAnyUploading}
          >
            {isUploadingQuestions ? (
              <>
                <ActivityIndicator size="small" color="#34C759" />
                <Text style={[styles.uploadButtonText, { color: '#34C759' }]}>
                  Uploading...
                </Text>
              </>
            ) : (
              <>
                <IconSymbol name="plus.circle.fill" size={16} color="#34C759" />
                <Text style={[styles.uploadButtonText, { color: '#34C759' }]}>
                  Upload
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
          Upload Excel (.xlsx) or CSV files with past exam questions to set the standard for AI-generated questions.
        </Text>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : referenceQuestions.length === 0 ? (
          <View style={styles.emptyState}>
            <IconSymbol name="tablecells" size={32} color={colors.textTertiary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No reference questions uploaded yet
            </Text>
          </View>
        ) : (
          <View style={styles.documentList}>
            {referenceQuestions.map((doc) => (
              <View
                key={doc.id}
                style={[styles.documentItem, { borderBottomColor: colors.border }]}
              >
                <View style={[styles.docIcon, { backgroundColor: '#34C75915' }]}>
                  <IconSymbol name="tablecells" size={20} color="#34C759" />
                </View>
                <View style={styles.docInfo}>
                  <Text style={[styles.docName, { color: colors.text }]} numberOfLines={1}>
                    {doc.filename}
                  </Text>
                  <View style={styles.docMeta}>
                    <Text style={[styles.docMetaText, { color: colors.textSecondary }]}>
                      {formatDate(doc.upload_timestamp)}
                    </Text>
                    {doc.parsed_question_count != null && doc.parsed_question_count > 0 && (
                      <>
                        <View style={[styles.metaDot, { backgroundColor: colors.textTertiary }]} />
                        <Text style={[styles.docMetaText, { color: '#34C759', fontWeight: '600' }]}>
                          {doc.parsed_question_count} questions
                        </Text>
                      </>
                    )}
                    <View style={[styles.metaDot, { backgroundColor: colors.textTertiary }]} />
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(doc.processing_status) + '20' }]}>
                      <Text style={[styles.statusText, { color: getStatusColor(doc.processing_status) }]}>
                        {doc.processing_status}
                      </Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDeleteReference(doc)}
                  disabled={deletingId === doc.id}
                >
                  {deletingId === doc.id ? (
                    <ActivityIndicator size="small" color={colors.error} />
                  ) : (
                    <IconSymbol name="trash.fill" size={18} color={colors.error} />
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Info Card */}
      <View style={[styles.infoCard, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
        <IconSymbol name="lightbulb.fill" size={20} color={colors.primary} />
        <View style={styles.infoContent}>
          <Text style={[styles.infoTitle, { color: colors.text }]}>How it works</Text>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            Reference materials help generate more unique questions. When a generated question is too similar to existing ones, the system uses these references to create more diverse alternatives.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: FontSizes.sm,
    lineHeight: 20,
  },
  section: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  sectionDescription: {
    fontSize: FontSizes.sm,
    lineHeight: 18,
    marginBottom: Spacing.md,
    marginTop: -Spacing.xs,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    gap: 4,
  },
  uploadButtonText: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  documentList: {
    gap: 0,
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  docIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  docInfo: {
    flex: 1,
  },
  docName: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
    marginBottom: 2,
  },
  docMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  docMetaText: {
    fontSize: FontSizes.xs,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  statusText: {
    fontSize: FontSizes.xs,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  deleteButton: {
    padding: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSizes.sm,
    textAlign: 'center',
  },
  loadingState: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
    marginBottom: 4,
  },
  infoText: {
    fontSize: FontSizes.sm,
    lineHeight: 18,
  },
  progressContainer: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  progressText: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
    flex: 1,
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressPercent: {
    fontSize: FontSizes.xs,
    marginTop: 4,
    textAlign: 'right',
  },
});

export default ReferenceMaterials;
