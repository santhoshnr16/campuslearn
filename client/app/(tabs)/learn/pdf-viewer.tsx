import React, { useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, TouchableOpacity, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Linking from 'expo-linking';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function PdfViewerScreen() {
    const { url, title } = useLocalSearchParams<{ url: string; title: string }>();
    const router = useRouter();
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    if (!url) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.errorContainer}>
                    <IconSymbol name="exclamationmark.triangle" size={48} color={colors.error} />
                    <Text style={[styles.errorText, { color: colors.text }]}>Invalid document URL</Text>
                    <TouchableOpacity style={[styles.backButton, { backgroundColor: colors.primary }]} onPress={() => router.back()}>
                        <Text style={styles.backButtonText}>Go Back</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
                <TouchableOpacity style={styles.backIcon} onPress={() => router.back()}>
                    <IconSymbol name="chevron.left" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                    {title || 'Document Preview'}
                </Text>
                <View style={{ width: 40 }} />
            </View>

            {/* PDF Viewer */}
            <View style={styles.pdfContainer}>
                {loading && !error && (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.primary} />
                        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading document...</Text>
                    </View>
                )}

                {error ? (
                    <View style={styles.errorContainer}>
                        <IconSymbol name="exclamationmark.triangle" size={48} color={colors.error} />
                        <Text style={[styles.errorText, { color: colors.text }]}>{error}</Text>
                        <TouchableOpacity style={[styles.backButton, { backgroundColor: colors.primary }]} onPress={() => router.back()}>
                            <Text style={styles.backButtonText}>Go Back</Text>
                        </TouchableOpacity>
                    </View>
                ) : Platform.OS === 'android' ? (
                    <View style={styles.androidFallbackContainer}>
                        <IconSymbol name="doc.text" size={64} color={colors.primary} />
                        <Text style={[styles.androidFallbackTitle, { color: colors.text }]}>Document Ready</Text>
                        <Text style={[styles.androidFallbackText, { color: colors.textSecondary }]}>
                            Tap below to open or download this document using your device's native PDF reader.
                        </Text>
                        <TouchableOpacity
                            style={[styles.openButton, { backgroundColor: colors.primary }]}
                            onPress={() => Linking.openURL(url)}
                        >
                            <Text style={styles.openButtonText}>Open Document</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <WebView
                        source={{ uri: url }}
                        style={styles.pdf}
                        onLoadEnd={() => setLoading(false)}
                        onError={(syntheticEvent) => {
                            const { nativeEvent } = syntheticEvent;
                            console.error('WebView error: ', nativeEvent);
                            setLoading(false);
                            setError('Failed to load document preview');
                        }}
                        startInLoadingState={true}
                        renderLoading={() => <View />}
                    />
                )}
            </View >
        </SafeAreaView >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderBottomWidth: 1,
    },
    backIcon: {
        padding: Spacing.xs,
        width: 40,
    },
    title: {
        flex: 1,
        fontSize: FontSizes.md,
        fontWeight: '600',
        textAlign: 'center',
    },
    pdfContainer: {
        flex: 1,
        position: 'relative',
    },
    pdf: {
        flex: 1,
    },
    loadingContainer: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },
    loadingText: {
        marginTop: Spacing.md,
        fontSize: FontSizes.sm,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: Spacing.xl,
    },
    errorText: {
        fontSize: FontSizes.md,
        marginTop: Spacing.md,
        marginBottom: Spacing.xl,
        textAlign: 'center',
    },
    backButton: {
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.md,
        borderRadius: 8,
    },
    backButtonText: {
        color: '#fff',
        fontWeight: '600',
        fontSize: FontSizes.md,
    },
    androidFallbackContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: Spacing.xl,
    },
    androidFallbackTitle: {
        fontSize: FontSizes.lg,
        fontWeight: 'bold',
        marginTop: Spacing.md,
    },
    androidFallbackText: {
        fontSize: FontSizes.md,
        textAlign: 'center',
        marginTop: Spacing.sm,
        marginBottom: Spacing.xl,
        paddingHorizontal: Spacing.lg,
    },
    openButton: {
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.md,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    openButtonText: {
        color: '#fff',
        fontWeight: '600',
        fontSize: FontSizes.md,
    },
});
