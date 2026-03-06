/**
 * XPGainPopup - Floating +XP animation that appears when earning XP
 * Features: Float up animation, scale bounce, fade out
 */
import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
} from 'react-native';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withDelay,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { FontSizes } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Spring config
const SPRING_BOUNCY = { damping: 8, stiffness: 150, mass: 0.5 };

interface XPGainPopupProps {
  amount: number;
  visible: boolean;
  position?: { x: number; y: number }; // Optional custom position
  onAnimationEnd?: () => void;
}

export const XPGainPopup: React.FC<XPGainPopupProps> = ({
  amount,
  visible,
  position,
  onAnimationEnd,
}) => {
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible && amount > 0) {
      // Haptic feedback
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      // Reset
      translateY.value = 0;
      translateX.value = 0;
      scale.value = 0;
      opacity.value = 0;
      
      // Animate
      scale.value = withSpring(1, SPRING_BOUNCY);
      opacity.value = withTiming(1, { duration: 200 });
      
      // Float up
      translateY.value = withSequence(
        withTiming(-20, { duration: 300 }),
        withTiming(-80, { duration: 1000 })
      );
      
      // Slight wobble
      translateX.value = withSequence(
        withTiming(5, { duration: 150 }),
        withTiming(-5, { duration: 150 }),
        withTiming(3, { duration: 150 }),
        withTiming(0, { duration: 150 })
      );
      
      // Fade out and callback
      opacity.value = withDelay(800, withTiming(0, { duration: 400 }, () => {
        if (onAnimationEnd) {
          runOnJS(onAnimationEnd)();
        }
      }));
      
      scale.value = withDelay(800, withTiming(0.5, { duration: 400 }));
    }
  }, [visible, amount]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
      { scale: scale.value },
    ],
    opacity: opacity.value,
    position: 'absolute',
    left: position?.x ?? SCREEN_WIDTH / 2 - 40,
    top: position?.y ?? 100,
    zIndex: 9999,
  }));

  if (!visible || amount <= 0) return null;

  const getXPColor = () => {
    if (amount >= 50) return '#FFD700'; // Gold for big XP
    if (amount >= 20) return '#34C759'; // Green
    return '#007AFF'; // Blue
  };

  const getEmoji = () => {
    if (amount >= 50) return '🌟';
    if (amount >= 20) return '⭐';
    return '✨';
  };

  return (
    <ReAnimated.View style={[styles.container, animatedStyle]} pointerEvents="none">
      <View style={[styles.badge, { backgroundColor: getXPColor() }]}>
        <Text style={styles.emoji}>{getEmoji()}</Text>
        <Text style={styles.text}>+{amount} XP</Text>
      </View>
    </ReAnimated.View>
  );
};

// Multi XP Popup - shows multiple XP gains stacked
interface MultiXPGainProps {
  gains: { id: string; amount: number; label?: string }[];
  onAllAnimationsEnd?: () => void;
}

export const MultiXPGain: React.FC<MultiXPGainProps> = ({
  gains,
  onAllAnimationsEnd,
}) => {
  const [completedCount, setCompletedCount] = React.useState(0);

  useEffect(() => {
    if (completedCount === gains.length && gains.length > 0) {
      onAllAnimationsEnd?.();
    }
  }, [completedCount, gains.length]);

  return (
    <View style={styles.multiContainer} pointerEvents="none">
      {gains.map((gain, index) => (
        <XPGainItem
          key={gain.id}
          amount={gain.amount}
          label={gain.label}
          delay={index * 200}
          onEnd={() => setCompletedCount((c) => c + 1)}
        />
      ))}
    </View>
  );
};

// Individual XP gain item for multi-gain display
const XPGainItem: React.FC<{
  amount: number;
  label?: string;
  delay: number;
  onEnd: () => void;
}> = ({ amount, label, delay, onEnd }) => {
  const translateY = useSharedValue(20);
  const translateX = useSharedValue(0);
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    // Delayed start
    translateY.value = withDelay(delay, withSequence(
      withSpring(-10, SPRING_BOUNCY),
      withDelay(600, withTiming(-50, { duration: 500 }))
    ));
    
    scale.value = withDelay(delay, withSpring(1, SPRING_BOUNCY));
    opacity.value = withDelay(delay, withSequence(
      withTiming(1, { duration: 200 }),
      withDelay(800, withTiming(0, { duration: 400 }, () => {
        runOnJS(onEnd)();
      }))
    ));
    
    // Slight random wobble
    const randomX = (Math.random() - 0.5) * 20;
    translateX.value = withDelay(delay, withTiming(randomX, { duration: 1200 }));
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  const getColor = () => {
    if (amount >= 50) return '#FFD700';
    if (amount >= 20) return '#34C759';
    return '#007AFF';
  };

  return (
    <ReAnimated.View style={[styles.multiItem, animatedStyle]}>
      <View style={[styles.badge, { backgroundColor: getColor() }]}>
        {label && <Text style={styles.label}>{label}</Text>}
        <Text style={styles.text}>+{amount} XP</Text>
      </View>
    </ReAnimated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  emoji: {
    fontSize: 18,
    marginRight: 6,
  },
  text: {
    color: '#FFF',
    fontSize: FontSizes.md,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  label: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: FontSizes.xs,
    fontWeight: '600',
    marginRight: 8,
  },
  multiContainer: {
    position: 'absolute',
    top: 150,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
  },
  multiItem: {
    marginBottom: 8,
  },
});
