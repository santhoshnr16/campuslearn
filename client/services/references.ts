/**
 * Reference Materials API Service
 * Handles reference books, template question papers, and reference questions per subject
 */

import apiClient from './api';

export interface ReferenceDocument {
  id: string;
  filename: string;
  file_size_bytes: number;
  mime_type: string | null;
  index_type: 'reference_book' | 'template_paper' | 'reference_questions';
  subject_id: string;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  total_chunks: number | null;
  upload_timestamp: string;
  processed_at: string | null;
  parsed_question_count?: number | null;
  is_public?: boolean;
}

export interface ReferenceMaterialsResponse {
  reference_books: ReferenceDocument[];
  template_papers: ReferenceDocument[];
  reference_questions: ReferenceDocument[];
}

export interface DocumentStatus {
  document_id: string;
  filename: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total_chunks: number | null;
  total_tokens: number | null;
  processed_at: string | null;
  processing_step: string | null;
  processing_progress: number;
  processing_detail: string | null;
  total_pages: number | null;
  error: string | null;
}

export type ProgressCallback = (progress: number) => void;


export const referencesService = {
  /**
   * Get all reference materials for a subject
   */
  async listReferences(subjectId: string): Promise<ReferenceMaterialsResponse> {
    const response = await apiClient.get<ReferenceMaterialsResponse>(
      `/documents/reference/list?subject_id=${subjectId}`
    );
    return response.data;
  },

  /**
   * Get document processing status (for polling)
   */
  async getDocumentStatus(documentId: string): Promise<DocumentStatus> {
    const response = await apiClient.get<DocumentStatus>(
      `/documents/${documentId}/status`
    );
    return response.data;
  },

  /**
   * Upload a reference book PDF
   */
  async uploadReferenceBook(
    subjectId: string,
    uri: string,
    filename: string,
    mimeType: string,
    onUploadProgress?: ProgressCallback
  ): Promise<{ document_id: string; status: string }> {
    const formData = new FormData();

    formData.append('file', {
      uri,
      name: filename,
      type: mimeType,
    } as unknown as Blob);
    formData.append('index_type', 'reference_book');
    formData.append('subject_id', subjectId);

    const response = await apiClient.post('/documents/reference/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 600000,
      onUploadProgress: onUploadProgress
        ? (progressEvent) => {
          if (progressEvent.total) {
            const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onUploadProgress(pct);
          }
        }
        : undefined,
    });

    return response.data;
  },

  /**
   * Upload a template question paper PDF
   */
  async uploadTemplatePaper(
    subjectId: string,
    uri: string,
    filename: string,
    mimeType: string,
    onUploadProgress?: ProgressCallback
  ): Promise<{ document_id: string; status: string }> {
    const formData = new FormData();

    formData.append('file', {
      uri,
      name: filename,
      type: mimeType,
    } as unknown as Blob);
    formData.append('index_type', 'template_paper');
    formData.append('subject_id', subjectId);

    const response = await apiClient.post('/documents/reference/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 600000,
      onUploadProgress: onUploadProgress
        ? (progressEvent) => {
          if (progressEvent.total) {
            const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onUploadProgress(pct);
          }
        }
        : undefined,
    });

    return response.data;
  },

  /**
   * Upload reference questions from Excel/CSV
   */
  async uploadReferenceQuestions(
    subjectId: string,
    uri: string,
    filename: string,
    mimeType: string,
    onUploadProgress?: ProgressCallback
  ): Promise<{ document_id: string; status: string; message: string }> {
    const formData = new FormData();

    formData.append('file', {
      uri,
      name: filename,
      type: mimeType,
    } as unknown as Blob);
    formData.append('index_type', 'reference_questions');
    formData.append('subject_id', subjectId);

    const response = await apiClient.post('/documents/reference/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 600000,
      onUploadProgress: onUploadProgress
        ? (progressEvent) => {
          if (progressEvent.total) {
            const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onUploadProgress(pct);
          }
        }
        : undefined,
    });

    return response.data;
  },

  /**
   * Toggle student visibility of a reference document
   */
  async toggleVisibility(documentId: string): Promise<{ document_id: string; is_public: boolean; message: string }> {
    const response = await apiClient.patch(`/documents/${documentId}/toggle-visibility`);
    return response.data;
  },

  /**
   * Delete a reference document
   */
  async deleteReference(documentId: string): Promise<void> {
    await apiClient.delete(`/documents/${documentId}`);
  },
};

export default referencesService;
