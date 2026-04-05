/**
 * Student Enrollment Browse Screen
 * Shows all published subjects with enrollment status and allows students to request enrollment.
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
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import learnService, { SubjectStudent } from '@/services/learn';

export default function EnrollScreen() {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    const router = useRouter();
    const [refreshing, setRefreshing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [subjects, setSubjects] = useState<SubjectStudent[]>([]);
    const [enrolling, setEnrolling] = useState<string | null>(null);

    const loadSubjects = useCallback(async () => {
        try {
            const data = await learnService.getAvailableSubjects();
            setSubjects(data);
        } catch (error) {
            console.error('Failed to load subjects:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSubjects();
    }, [loadSubjects]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await loadSubjects();
        setRefreshing(false);
    }, [loadSubjects]);

    const handleEnroll = async (subject: SubjectStudent) => {
        if (enrolling) return;
        setEnrolling(subject.id);
        try {
            await learnService.enrollInSubject(subject.id);
            Alert.alert(
                'Request Sent! 📩',
                `Your enrollment request for "${subject.name}" has been sent to ${subject.teacher_name || 'the teacher'}. You'll be enrolled once approved.`
            );
            await loadSubjects();
        } catch (error: any) {
            Alert.alert(
                'Error',
                error?.response?.data?.detail || 'Failed to request enrollment'
            );
        } finally {
            setEnrolling(null);
        }
    };

    const getStatusBadge = (status?: string) => {
        switch (status) {
            case 'pending':
                return { text: '⏳ Pending', bg: '#FF950020', color: '#FF9500' };
            case 'approved':
                return { text: '✅ Enrolled', bg: '#34C75920', color: '#34C759' };
            case 'rejected':
                return { text: '❌ Rejected', bg: '#FF3B3020', color: '#FF3B30' };
            default:
                return null;
        }
    };

    return (
        <>
            <Stack.Screen
                options={{
                    headerShown: true,
                    title: 'Browse Subjects',
                    headerBackTitle: 'Back',
                    headerShadowVisible: false,
                    headerStyle: { backgroundColor: colors.background },
                    headerTintColor: colors.primary,
                    headerTitleStyle: { color: colors.text, fontWeight: '600' },
                }}
            />
            <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['bottom']}>

                <ScrollView
                    contentContainerStyle={styles.content}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                >
                    {loading ? (
                        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 60 }} />
                    ) : subjects.length === 0 ? (
                        <View style={styles.emptyState}>
                            <Text style={styles.emptyEmoji}>📚</Text>
                            <Text style={[styles.emptyTitle, { color: colors.text }]}>
                                No subjects available
                            </Text>
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                Check back later when teachers publish subjects.
                            </Text>
                        </View>
                    ) : (
                        <>
                            <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
                                Request enrollment in subjects taught by your teachers. Once approved, you can access lessons and tests.
                            </Text>

                            {subjects.map((subject) => {
                                const badge = getStatusBadge(subject.enrollment_status);
                                const canEnroll = !subject.enrollment_status || subject.enrollment_status === 'rejected';

                                return (
                                    <View
                                        key={subject.id}
                                        style={[styles.subjectCard, { backgroundColor: colors.backgroundSecondary }]}
                                    >
                                        <View style={styles.cardHeader}>
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.subjectCode, { color: colors.primary }]}>
                                                    {subject.code}
                                                </Text>
                                                <Text style={[styles.subjectName, { color: colors.text }]} numberOfLines={2}>
                                                    {subject.name}
                                                </Text>
                                            </View>
                                            {badge && (
                                                <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                                                    <Text style={[styles.statusText, { color: badge.color }]}>
                                                        {badge.text}
                                                    </Text>
                                                </View>
                                            )}
                                        </View>

                                        {subject.description ? (
                                            <Text
                                                style={[styles.description, { color: colors.textSecondary }]}
                                                numberOfLines={2}
                                            >
                                                {subject.description}
                                            </Text>
                                        ) : null}

                                        <View style={styles.metaRow}>
                                            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                                                👤 {subject.teacher_name || 'Teacher'}
                                            </Text>
                                            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                                                📖 {subject.total_topics} topics
                                            </Text>
                                        </View>

                                        {canEnroll && (
                                            <TouchableOpacity
                                                style={[
                                                    styles.enrollButton,
                                                    { backgroundColor: colors.primary },
                                                    enrolling === subject.id && styles.enrollButtonDisabled,
                                                ]}
                                                onPress={() => handleEnroll(subject)}
                                                disabled={enrolling === subject.id}
                                            >
                                                {enrolling === subject.id ? (
                                                    <ActivityIndicator size="small" color="#fff" />
                                                ) : (
                                                    <Text style={styles.enrollButtonText}>
                                                        {subject.enrollment_status === 'rejected'
                                                            ? '🔄 Re-request Enrollment'
                                                            : '📩 Request Enrollment'}
                                                    </Text>
                                                )}
                                            </TouchableOpacity>
                                        )}

                                        {subject.enrollment_status === 'pending' && (
                                            <Text style={[styles.pendingNote, { color: '#FF9500' }]}>
                                                Waiting for teacher approval...
                                            </Text>
                                        )}

                                        {subject.enrollment_status === 'approved' && (
                                            <View style={styles.enrolledInfo}>
                                                <Text style={[styles.metaText, { color: '#34C759' }]}>
                                                    🎓 {Math.round(subject.mastery)}% mastery · {subject.xp_earned} XP
                                                </Text>
                                            </View>
                                        )}
                                    </View>
                                );
                            })}
                        </>
                    )}
                </ScrollView>
            </SafeAreaView>
        </>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    header: { display: 'none' }, // legacy
    backButton: { display: 'none' },
    backText: { display: 'none' },
    title: { display: 'none' },
    content: { paddingHorizontal: Spacing.lg, paddingBottom: 100 },
    sectionDesc: {
        fontSize: FontSizes.sm,
        marginBottom: Spacing.lg,
        lineHeight: 20,
    },
    subjectCard: {
        borderRadius: BorderRadius.lg,
        padding: Spacing.lg,
        marginBottom: Spacing.md,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    subjectCode: { fontSize: FontSizes.xs, fontWeight: '700', marginBottom: 4 },
    subjectName: { fontSize: FontSizes.md, fontWeight: '600' },
    description: { fontSize: FontSizes.sm, marginTop: Spacing.sm, lineHeight: 18 },
    metaRow: {
        flexDirection: 'row',
        gap: Spacing.lg,
        marginTop: Spacing.sm,
    },
    metaText: { fontSize: FontSizes.xs },
    statusBadge: {
        paddingHorizontal: Spacing.sm,
        paddingVertical: 4,
        borderRadius: BorderRadius.sm,
        marginLeft: Spacing.sm,
    },
    statusText: { fontSize: FontSizes.xs, fontWeight: '600' },
    enrollButton: {
        marginTop: Spacing.md,
        paddingVertical: Spacing.sm + 2,
        borderRadius: BorderRadius.md,
        alignItems: 'center',
    },
    enrollButtonDisabled: { opacity: 0.6 },
    enrollButtonText: { color: '#fff', fontWeight: '700', fontSize: FontSizes.sm },
    pendingNote: {
        marginTop: Spacing.sm,
        fontSize: FontSizes.xs,
        fontWeight: '500',
        textAlign: 'center',
    },
    enrolledInfo: { marginTop: Spacing.sm },
    emptyState: { alignItems: 'center', paddingTop: 80 },
    emptyEmoji: { fontSize: 48 },
    emptyTitle: { fontSize: FontSizes.lg, fontWeight: '600', marginTop: Spacing.md },
    emptyText: {
        fontSize: FontSizes.sm,
        marginTop: Spacing.xs,
        textAlign: 'center',
        paddingHorizontal: 40,
    },
});
