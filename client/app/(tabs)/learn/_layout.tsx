import { Stack } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export default function LearnLayout() {
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
        headerTitleStyle: {
          fontWeight: '600',
          color: colors.text,
        },
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
      <Stack.Screen
        name="lesson"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="result"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="subject-detail"
        options={{
          title: 'Subject',
        }}
      />
      <Stack.Screen
        name="topic-content"
        options={{
          title: 'Topic',
        }}
      />
      <Stack.Screen
        name="pdf-viewer"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
}
