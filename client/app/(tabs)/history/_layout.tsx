import { Stack } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export default function HistoryLayout() {
    const colorScheme = useColorScheme();
    const colors = Colors[colorScheme ?? 'light'];

    return (
        <Stack
            screenOptions={{
                headerShown: true,
                headerTransparent: true,
                headerStyle: {
                    backgroundColor: 'transparent',
                },
                headerTintColor: colors.primary,
                headerTitleStyle: { fontWeight: '600', color: colors.text },
                headerShadowVisible: false,
                headerBackTitle: 'Back',
            }}
        >
            <Stack.Screen
                name="index"
                options={{
                    headerShown: false,
                }}
            />
        </Stack>
    );
}
