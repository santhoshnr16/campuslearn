/**
 * StreakCelebration - Animated modal for streak achievements
 * Features: Fire emoji burst, scale animation, confetti particles
 */
import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withDelay,
  withTiming,
  withRepeat,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Colors, FontSizes, Spacing, BorderRadius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Spring configs
const SPRING_BOUNCY = { damping: 8, stiffness: 150, mass: 0.8 };

// Animated fire particle
const FireParticle = ({ delay, startX, startY }: { delay: number; startX: number; startY: number }) => {
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.5);
  const rotate = useSharedValue(0);

  useEffect(() => {
    const randomX = (Math.random() - 0.5) * 200;
    const randomY = -Math.random() * 300 - 100;
    
    translateX.value = withDelay(delay, withSpring(randomX, { damping: 15, stiffness: 80 }));
    translateY.value = withDelay(delay, withSpring(randomY, { damping: 15, stiffness: 80 }));
    opacity.value = withDelay(delay, withSequence(
      withTiming(1, { duration: 200 }),
      withDelay(800, withTiming(0, { duration: 500 }))
    ));
    scale.value = withDelay(delay, withSequence(
      withSpring(1.2, SPRING_BOUNCY),
      withTiming(0.3, { duration: 800 })
    ));
    rotate.value = withDelay(delay, withTiming(
      (Math.random() - 0.5) * 720,
      { duration: 1500 }
    ));
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
    position: 'absolute',
    left: startX,
    top: startY,
  }));

  const emojis = ['🔥', '⭐', '✨', '💫', '🌟'];
  const emoji = emojis[Math.floor(Math.random() * emojis.length)];

  return (
    <ReAnimated.View style={animatedStyle}>
      <Text style={{ fontSize: 24 }}>{emoji}</Text>
    </ReAnimated.View>
  );
};

interface StreakCelebrationProps {
  visible: boolean;
  streak: number;
  onClose: () => void;
}

export const StreakCelebration: React.FC<StreakCelebrationProps> = ({
  visible,
  streak,
  onClose,
}) => {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  
  const containerScale = useSharedValue(0);
  const containerOpacity = useSharedValue(0);
  const streakScale = useSharedValue(0.5);
  const streakRotate = useSharedValue(-15);
  const fireScale = useSharedValue(1);
  const textSlide = useSharedValue(50);
  const textOpacity = useSharedValue(0);
  const buttonOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Animate in
      containerOpacity.value = withTiming(1, { duration: 300 });
      containerScale.value = withSpring(1, SPRING_BOUNCY);
      
      streakScale.value = withDelay(200, withSpring(1, SPRING_BOUNCY));
      streakRotate.value = withDelay(200, withSequence(
        withSpring(10, { damping: 5, stiffness: 200 }),
        withSpring(0, { damping: 10, stiffness: 150 })
      ));
      
      fireScale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 500 }),
          withTiming(1, { duration: 500 })
        ),
        -1,
        true
      );
      
      textSlide.value = withDelay(400, withSpring(0, SPRING_BOUNCY));
      textOpacity.value = withDelay(400, withTiming(1, { duration: 300 }));
      
      buttonOpacity.value = withDelay(800, withTiming(1, { duration: 300 }));
    } else {
      // Reset
      containerScale.value = 0;
      containerOpacity.value = 0;
      streakScale.value = 0.5;
      streakRotate.value = -15;
      textSlide.value = 50;
      textOpacity.value = 0;
      buttonOpacity.value = 0;
    }
  }, [visible]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: containerScale.value }],
    opacity: containerOpacity.value,
  }));

  const streakBadgeStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: streakScale.value },
      { rotate: `${streakRotate.value}deg` },
    ],
  }));

  const fireStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fireScale.value }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: textSlide.value }],
    opacity: textOpacity.value,
  }));

  const buttonStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
  }));

  const getStreakMessage = () => {
    if (streak >= 30) return "You're on fire! 30 days! 🏆";
    if (streak >= 14) return "Two weeks strong! 💪";
    if (streak >= 7) return "A whole week! Amazing! 🌟";
    if (streak >= 3) return "Keep it going! 🔥";
    return "Great start! Keep learning! ✨";
  };

  // Generate particle positions
  const particles = Array.from({ length: 15 }, (_, i) => ({
    id: i,
    delay: Math.random() * 300,
    startX: SCREEN_WIDTH / 2 - 12,
    startY: SCREEN_HEIGHT / 2 - 100,
  }));

  return (
    <Modal visible={visible} transparent animationType="none">
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.85)' }]}>
        {/* Particles */}
        {visible && particles.map((p) => (
          <FireParticle
            key={p.id}
            delay={p.delay}
            startX={p.startX}
            startY={p.startY}
          />
        ))}

        <ReAnimated.View style={[styles.content, containerStyle]}>
          {/* Main Fire Icon */}
          <ReAnimated.View style={[styles.fireContainer, fireStyle]}>
            <Text style={styles.fireEmoji}>🔥</Text>
          </ReAnimated.View>

          {/* Streak Badge */}
          <ReAnimated.View style={[styles.streakBadge, streakBadgeStyle]}>
            <Text style={styles.streakNumber}>{streak}</Text>
            <Text style={styles.streakLabel}>DAY STREAK</Text>
          </ReAnimated.View>

          {/* Message */}
          <ReAnimated.View style={textStyle}>
            <Text style={[styles.title, { color: '#FFF' }]}>
              🎉 Streak Extended! 🎉
            </Text>
            <Text style={[styles.message, { color: 'rgba(255,255,255,0.8)' }]}>
              {getStreakMessage()}
            </Text>
          </ReAnimated.View>

          {/* Close Button */}
          <ReAnimated.View style={[styles.buttonContainer, buttonStyle]}>
            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: '#FF9500' }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onClose();
              }}
            >
              <Text style={styles.closeButtonText}>Continue 🔥</Text>
            </TouchableOpacity>
          </ReAnimated.View>
        </ReAnimated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  fireContainer: {
    marginBottom: Spacing.md,
  },
  fireEmoji: {
    fontSize: 80,
  },
  streakBadge: {
    backgroundColor: '#FF9500',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: BorderRadius.xl,
    alignItems: 'center',
    marginBottom: Spacing.xl,
    shadowColor: '#FF9500',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  streakNumber: {
    fontSize: 48,
    fontWeight: '900',
    color: '#FFF',
  },
  streakLabel: {
    fontSize: FontSizes.sm,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 2,
    marginTop: 4,
  },
  title: {
    fontSize: FontSizes.xxl,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  message: {
    fontSize: FontSizes.md,
    textAlign: 'center',
    lineHeight: 24,
  },
  buttonContainer: {
    marginTop: Spacing.xl,
  },
  closeButton: {
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: BorderRadius.xl,
  },
  closeButtonText: {
    color: '#FFF',
    fontSize: FontSizes.md,
    fontWeight: '700',
  },
});
