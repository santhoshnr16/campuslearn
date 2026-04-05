import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, useWindowDimensions, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, FontSizes, Spacing, BorderRadius } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import learnService from '@/services/learn';

export default function TopicContentScreen() {
  const { subjectId, topicId, topicName } = useLocalSearchParams<{ subjectId: string; topicId: string; topicName: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTopicContent();
  }, [topicId]);

  const loadTopicContent = async () => {
    if (!subjectId || !topicId) return;
    setLoading(true);
    setError(null);
    try {
      const subjectResponse = await learnService.getTopics(subjectId);
      const topic = subjectResponse.topics?.find((t: any) => t.id === topicId);

      if (topic && topic.syllabus_content) {
        setContent(topic.syllabus_content);
      } else {
        setError("This topic doesn't have any learning content available yet.");
      }
    } catch (err) {
      console.error('Failed to load topic content:', err);
      setError('Failed to load the learning material. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const markdownStyles = StyleSheet.create({
    body: {
      color: colors.text,
      fontSize: FontSizes.md,
      lineHeight: 24,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    heading1: {
      fontSize: FontSizes.xxl,
      fontWeight: '700',
      color: colors.text,
      marginTop: Spacing.xl,
      marginBottom: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingBottom: Spacing.sm,
    },
    heading2: {
      fontSize: FontSizes.xl,
      fontWeight: '600',
      color: colors.text,
      marginTop: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    heading3: {
      fontSize: FontSizes.lg,
      fontWeight: '600',
      color: colors.text,
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: Spacing.md,
    },
    list_item: {
      marginTop: 0,
      marginBottom: Spacing.xs,
    },
    bullet_list: {
      marginTop: 0,
      marginBottom: Spacing.md,
    },
    ordered_list: {
      marginTop: 0,
      marginBottom: Spacing.md,
    },
    blockquote: {
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      borderLeftWidth: 4,
      borderLeftColor: colors.primary,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      marginBottom: Spacing.md,
      borderRadius: BorderRadius.sm,
    },
    code_inline: {
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
      color: isDark ? '#FF9500' : '#D97706',
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    fence: {
      backgroundColor: isDark ? '#1C1C1E' : '#2D2D30',
      color: '#D4D4D4',
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      padding: Spacing.md,
      borderRadius: BorderRadius.md,
      marginBottom: Spacing.md,
      overflow: 'hidden',
    },
    strong: {
      fontWeight: 'bold',
    },
    em: {
      fontStyle: 'italic',
    },
    hr: {
      backgroundColor: colors.border,
      height: StyleSheet.hairlineWidth,
      marginVertical: Spacing.lg,
    }
  });

  if (loading) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            title: topicName || 'Loading...',
            headerBackTitle: 'Back',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.primary,
            headerTitleStyle: { color: colors.text, fontWeight: '600' },
          }}
        />
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading Content...</Text>
          </View>
        </SafeAreaView>
      </>
    );
  }

  if (error || !content) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            title: 'Error',
            headerBackTitle: 'Back',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.primary,
            headerTitleStyle: { color: colors.text, fontWeight: '600' },
          }}
        />
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
          <View style={styles.centerContainer}>
            <IconSymbol name="doc.text.magnifyingglass" size={48} color={colors.textTertiary} />
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error || 'Content not found'}</Text>
            <TouchableOpacity style={[styles.retryButton, { backgroundColor: colors.primary }]} onPress={() => router.back()}>
              <Text style={styles.retryButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          title: topicName || 'Chapter Details',
          headerBackTitle: 'Back',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: 'transparent' },
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text, fontWeight: '600' },
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
        >
          <Markdown
            style={markdownStyles}
          >
            {content}
          </Markdown>
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: { display: 'none' }, // legacy, kept around just in case
  backButton: { display: 'none' },
  headerTitleContainer: { display: 'none' },
  headerTitle: { display: 'none' },
  headerSubtitle: { display: 'none' },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingTop: 110,
    paddingBottom: Spacing.xxl * 2,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: FontSizes.md,
  },
  errorText: {
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    fontSize: FontSizes.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: FontSizes.sm,
  },
});
