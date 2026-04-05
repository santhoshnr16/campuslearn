import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
    Alert,
    Platform,
    StatusBar,
} from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { GlassCard } from '@/components/ui/glass-card';
import { Colors, Spacing, BorderRadius, FontSizes } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subjectsService, PendingEnrollment, Subject } from '@/services/subjects';

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

export default function EnrollmentsScreen() {
    const colorScheme = useColorScheme();
    const colors = Colors[colorScheme ?? 'light'];

    const [enrollments, setEnrollments] = useState<PendingEnrollment[]>([]);
    const [subjects, setSubjects] = useState<Subject[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
    const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const loadData = useCallback(async (refresh = false) => {
        try {
            if (refresh) setIsRefreshing(true);
            else setIsLoading(true);

            const [enrollmentsData, subjectsData] = await Promise.all([
                subjectsService.getAllEnrollments(statusFilter),
                subjectsService.listSubjects(1, 100),
            ]);

            setEnrollments(enrollmentsData);
            setSubjects(subjectsData.subjects || []);
        } catch (error) {
            console.error('Failed to load enrollments:', error);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleApprove = async (enrollment: PendingEnrollment) => {
        setActionLoading(enrollment.id);
        try {
            await subjectsService.approveEnrollment(enrollment.subject_id, enrollment.id);
            setEnrollments(prev => prev.filter(e => e.id !== enrollment.id));
        } catch (error) {
            Alert.alert('Error', 'Failed to approve enrollment');
        } finally {
            setActionLoading(null);
        }
    };

    const handleReject = async (enrollment: PendingEnrollment) => {
        Alert.alert(
            'Reject Enrollment',
            `Reject ${enrollment.student_name}'s enrollment in ${enrollment.subject_name}?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reject',
                    style: 'destructive',
                    onPress: async () => {
                        setActionLoading(enrollment.id);
                        try {
                            await subjectsService.rejectEnrollment(enrollment.subject_id, enrollment.id);
                            setEnrollments(prev => prev.filter(e => e.id !== enrollment.id));
                        } catch (error) {
                            Alert.alert('Error', 'Failed to reject enrollment');
                        } finally {
                            setActionLoading(null);
                        }
                    },
                },
            ]
        );
    };

    const handleRevoke = async (enrollment: PendingEnrollment) => {
        Alert.alert(
            'Revoke Enrollment',
            `Revoke ${enrollment.student_name}'s access to ${enrollment.subject_name}? They will need to re-enroll.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Revoke',
                    style: 'destructive',
                    onPress: async () => {
                        setActionLoading(enrollment.id);
                        try {
                            await subjectsService.rejectEnrollment(enrollment.subject_id, enrollment.id);
                            setEnrollments(prev => prev.filter(e => e.id !== enrollment.id));
                        } catch (error) {
                            Alert.alert('Error', 'Failed to revoke enrollment');
                        } finally {
                            setActionLoading(null);
                        }
                    },
                },
            ]
        );
    };

    const filteredEnrollments = subjectFilter
        ? enrollments.filter(e => e.subject_id === subjectFilter)
        : enrollments;

    // Get unique subjects from enrollments for filter chips
    const enrollmentSubjects = [...new Set(enrollments.map(e => e.subject_id))]
        .map(id => {
            const enrollment = enrollments.find(e => e.subject_id === id);
            return { id, name: enrollment?.subject_name || 'Unknown' };
        });

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const statusTabs: { key: StatusFilter; label: string; color: string }[] = [
        { key: 'pending', label: 'Pending', color: '#FF9500' },
        { key: 'approved', label: 'Approved', color: '#34C759' },
        { key: 'rejected', label: 'Rejected', color: '#FF3B30' },
    ];

    if (isLoading) {
        return (
            <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading enrollments...</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={isRefreshing} onRefresh={() => loadData(true)} />
                }
            >
                {/* Status Tabs */}
                <View style={styles.tabsContainer}>
                    {statusTabs.map(tab => (
                        <TouchableOpacity
                            key={tab.key}
                            style={[
                                styles.tab,
                                {
                                    backgroundColor: statusFilter === tab.key ? tab.color + '20' : colors.card,
                                    borderColor: statusFilter === tab.key ? tab.color : colors.border,
                                },
                            ]}
                            onPress={() => {
                                setStatusFilter(tab.key);
                                setSubjectFilter(null);
                            }}
                        >
                            <Text
                                style={[
                                    styles.tabText,
                                    { color: statusFilter === tab.key ? tab.color : colors.textSecondary },
                                ]}
                            >
                                {tab.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Subject Filter Chips */}
                {enrollmentSubjects.length > 1 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
                        <TouchableOpacity
                            style={[
                                styles.filterChip,
                                {
                                    backgroundColor: !subjectFilter ? colors.primary + '20' : colors.card,
                                    borderColor: !subjectFilter ? colors.primary : colors.border,
                                },
                            ]}
                            onPress={() => setSubjectFilter(null)}
                        >
                            <Text style={{ fontSize: 12, color: !subjectFilter ? colors.primary : colors.textSecondary, fontWeight: '600' }}>
                                All Subjects
                            </Text>
                        </TouchableOpacity>
                        {enrollmentSubjects.map(subj => (
                            <TouchableOpacity
                                key={subj.id}
                                style={[
                                    styles.filterChip,
                                    {
                                        backgroundColor: subjectFilter === subj.id ? colors.primary + '20' : colors.card,
                                        borderColor: subjectFilter === subj.id ? colors.primary : colors.border,
                                    },
                                ]}
                                onPress={() => setSubjectFilter(subjectFilter === subj.id ? null : subj.id)}
                            >
                                <Text style={{ fontSize: 12, color: subjectFilter === subj.id ? colors.primary : colors.textSecondary, fontWeight: '600' }}>
                                    {subj.name}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                )}

                {/* Count */}
                <Text style={[styles.resultCount, { color: colors.textSecondary }]}>
                    {filteredEnrollments.length} enrollment{filteredEnrollments.length !== 1 ? 's' : ''}
                </Text>

                {/* Enrollment Cards */}
                {filteredEnrollments.length === 0 ? (
                    <View style={styles.emptyState}>
                        <IconSymbol name="person.2.fill" size={48} color={colors.textTertiary} />
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>
                            No {statusFilter} enrollments
                        </Text>
                        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                            {statusFilter === 'pending'
                                ? 'Students will appear here when they request to enroll'
                                : `No ${statusFilter} enrollments to show`}
                        </Text>
                    </View>
                ) : (
                    filteredEnrollments.map(enrollment => (
                        <GlassCard key={enrollment.id} style={styles.enrollmentCard}>
                            <View style={styles.enrollmentHeader}>
                                <View style={[styles.avatarCircle, { backgroundColor: colors.primary + '20' }]}>
                                    <Text style={[styles.avatarText, { color: colors.primary }]}>
                                        {(enrollment.student_name || 'U')[0].toUpperCase()}
                                    </Text>
                                </View>
                                <View style={styles.enrollmentInfo}>
                                    <Text style={[styles.studentName, { color: colors.text }]}>
                                        {enrollment.student_name || 'Unknown Student'}
                                    </Text>
                                    <Text style={[styles.studentEmail, { color: colors.textSecondary }]}>
                                        {enrollment.student_email}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.enrollmentMeta}>
                                <View style={[styles.subjectBadge, { backgroundColor: colors.primary + '10' }]}>
                                    <IconSymbol name="book.closed.fill" size={12} color={colors.primary} />
                                    <Text style={[styles.subjectBadgeText, { color: colors.primary }]}>
                                        {enrollment.subject_name}
                                    </Text>
                                </View>
                                <Text style={[styles.enrollmentDate, { color: colors.textTertiary }]}>
                                    {formatDate(enrollment.enrolled_at)}
                                </Text>
                            </View>

                            {/* Action Buttons */}
                            <View style={styles.actionRow}>
                                {enrollment.status === 'pending' && (
                                    <>
                                        <TouchableOpacity
                                            style={[styles.actionBtn, styles.approveBtn]}
                                            onPress={() => handleApprove(enrollment)}
                                            disabled={actionLoading === enrollment.id}
                                        >
                                            {actionLoading === enrollment.id ? (
                                                <ActivityIndicator size="small" color="#FFFFFF" />
                                            ) : (
                                                <>
                                                    <IconSymbol name="checkmark.circle.fill" size={16} color="#FFFFFF" />
                                                    <Text style={styles.actionBtnText}>Approve</Text>
                                                </>
                                            )}
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.actionBtn, styles.rejectBtn]}
                                            onPress={() => handleReject(enrollment)}
                                            disabled={actionLoading === enrollment.id}
                                        >
                                            <IconSymbol name="xmark.circle.fill" size={16} color="#FF3B30" />
                                            <Text style={[styles.actionBtnText, { color: '#FF3B30' }]}>Reject</Text>
                                        </TouchableOpacity>
                                    </>
                                )}
                                {enrollment.status === 'approved' && (
                                    <TouchableOpacity
                                        style={[styles.actionBtn, styles.revokeBtn]}
                                        onPress={() => handleRevoke(enrollment)}
                                        disabled={actionLoading === enrollment.id}
                                    >
                                        {actionLoading === enrollment.id ? (
                                            <ActivityIndicator size="small" color="#FF3B30" />
                                        ) : (
                                            <>
                                                <IconSymbol name="xmark.circle.fill" size={16} color="#FF3B30" />
                                                <Text style={[styles.actionBtnText, { color: '#FF3B30' }]}>Revoke Access</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                )}
                                {enrollment.status === 'rejected' && (
                                    <View style={[styles.statusBadge, { backgroundColor: '#FF3B3015' }]}>
                                        <Text style={{ fontSize: 12, fontWeight: '600', color: '#FF3B30' }}>Rejected</Text>
                                    </View>
                                )}
                            </View>
                        </GlassCard>
                    ))
                )}

                <View style={{ height: Platform.OS === 'ios' ? 100 : 80 }} />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { marginTop: Spacing.md, fontSize: FontSizes.sm },
    scrollContent: {
        paddingTop: Platform.OS === 'ios' ? 10 : (StatusBar.currentHeight ?? 24) + 10,
        paddingHorizontal: Spacing.lg,
    },
    tabsContainer: {
        flexDirection: 'row',
        gap: Spacing.sm,
        marginBottom: Spacing.md,
    },
    tab: {
        flex: 1,
        paddingVertical: Spacing.sm,
        borderRadius: BorderRadius.md,
        alignItems: 'center',
        borderWidth: 1,
    },
    tabText: {
        fontSize: FontSizes.sm,
        fontWeight: '600',
    },
    filterRow: {
        marginBottom: Spacing.md,
    },
    filterChip: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
        borderRadius: BorderRadius.full,
        borderWidth: 1,
        marginRight: Spacing.sm,
    },
    resultCount: {
        fontSize: FontSizes.xs,
        marginBottom: Spacing.md,
    },
    emptyState: {
        alignItems: 'center',
        paddingTop: 60,
    },
    emptyTitle: {
        fontSize: FontSizes.lg,
        fontWeight: '600',
        marginTop: Spacing.md,
    },
    emptySubtitle: {
        fontSize: FontSizes.sm,
        textAlign: 'center',
        marginTop: Spacing.xs,
        paddingHorizontal: Spacing.xl,
    },
    enrollmentCard: {
        marginBottom: Spacing.md,
        marginHorizontal: 0,
        marginTop: 0,
    },
    enrollmentHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: Spacing.sm,
    },
    avatarCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: {
        fontSize: FontSizes.lg,
        fontWeight: '700',
    },
    enrollmentInfo: {
        marginLeft: Spacing.sm,
        flex: 1,
    },
    studentName: {
        fontSize: FontSizes.md,
        fontWeight: '600',
    },
    studentEmail: {
        fontSize: FontSizes.xs,
        marginTop: 1,
    },
    enrollmentMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: Spacing.sm,
    },
    subjectBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.sm,
        paddingVertical: 3,
        borderRadius: BorderRadius.sm,
        gap: 4,
    },
    subjectBadgeText: {
        fontSize: FontSizes.xs,
        fontWeight: '600',
    },
    enrollmentDate: {
        fontSize: FontSizes.xs,
    },
    actionRow: {
        flexDirection: 'row',
        gap: Spacing.sm,
        marginTop: Spacing.xs,
    },
    actionBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: Spacing.sm,
        borderRadius: BorderRadius.md,
        gap: 4,
    },
    approveBtn: {
        backgroundColor: '#34C759',
    },
    rejectBtn: {
        backgroundColor: '#FF3B3015',
        borderWidth: 1,
        borderColor: '#FF3B3030',
    },
    revokeBtn: {
        backgroundColor: '#FF3B3015',
        borderWidth: 1,
        borderColor: '#FF3B3030',
    },
    actionBtnText: {
        fontSize: FontSizes.sm,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    statusBadge: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
        borderRadius: BorderRadius.sm,
    },
});
