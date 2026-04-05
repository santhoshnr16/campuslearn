import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Switch,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { GlassCard } from '@/components/ui/glass-card';
import { Colors, Spacing, BorderRadius, FontSizes } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/components/toast';
import { subjectsService } from '@/services/subjects';
import { vettingService } from '@/services/vetting';
import { API_BASE_URL } from '@/services/api';
import { selectionImpact, mediumImpact, heavyImpact } from '@/utils/haptics';

type ModalType = 'editProfile' | 'changePassword' | 'notifications' | 'appearance' | 'help' | 'about' | null;

export default function ProfileScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user, logout, updateProfile, changePassword, uploadAvatar, deleteAvatar, isLoading: authLoading } = useAuthStore();
  const navigation = useNavigation();
  const { showError, showSuccess, showWarning } = useToast();

  const [activeModal, setActiveModal] = useState<ModalType>(null);

  useEffect(() => {
    // Hide tab bar and header title on this screen
    navigation.getParent()?.setOptions({
      tabBarStyle: { display: 'none' },
      headerShown: false,
    });

    // Load statistics
    loadStatistics();

    return () => {
      // Show tab bar again when leaving (do NOT toggle parent headerShown here)
      navigation.getParent()?.setOptions({
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: 60,
        },
      });
    };
  }, [navigation, colors]);

  // Edit Profile State
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [email, setEmail] = useState(user?.email || '');

  // Change Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Notification Settings
  const [pushNotifications, setPushNotifications] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [questionGenerated, setQuestionGenerated] = useState(true);
  const [vettingReminders, setVettingReminders] = useState(false);

  // Statistics State
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [approvedQuestions, setApprovedQuestions] = useState(0);
  const [totalSubjects, setTotalSubjects] = useState(0);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  const loadStatistics = async () => {
    try {
      setIsLoadingStats(true);

      // Fetch vetting stats and subjects
      const [vettingStatsResponse, subjectsResponse] = await Promise.all([
        vettingService.getVettingStats().catch(() => ({ total_generated: 0, total_approved: 0 })),
        subjectsService.listSubjects(1, 100),
      ]);

      const vettingStats = vettingStatsResponse || { total_generated: 0, total_approved: 0 };
      const subjects = subjectsResponse?.subjects || [];

      setTotalQuestions(vettingStats.total_generated);
      setApprovedQuestions(vettingStats.total_approved);
      setTotalSubjects(subjects.length);

      console.log('[Profile] Statistics loaded:', {
        totalQuestions: vettingStats.total_generated,
        approvedQuestions: vettingStats.total_approved,
        totalSubjects: subjects.length,
      });
    } catch (error) {
      console.error('[Profile] Failed to load statistics:', error);
      // Set default values on error
      setTotalQuestions(0);
      setApprovedQuestions(0);
      setTotalSubjects(0);
    } finally {
      setIsLoadingStats(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: logout,
        },
      ]
    );
  };

  const [isSaving, setIsSaving] = useState(false);

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      await updateProfile({ full_name: fullName });
      showSuccess('Profile updated successfully');
      setActiveModal(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update profile';
      showError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      showWarning('Passwords do not match', 'Validation Error');
      return;
    }
    if (newPassword.length < 8) {
      showWarning('Password must be at least 8 characters', 'Validation Error');
      return;
    }
    setIsSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      showSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setActiveModal(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to change password';
      showError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePickAvatar = async () => {
    try {
      // Request permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showWarning('Permission to access photos is required');
        return;
      }

      // Pick image
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;
        await uploadAvatar(uri);
        showSuccess('Avatar updated successfully');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload avatar';
      showError(message);
    }
  };

  const handleDeleteAvatar = () => {
    mediumImpact();
    Alert.alert(
      'Remove Avatar',
      'Are you sure you want to remove your profile picture?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              heavyImpact();
              await deleteAvatar();
              showSuccess('Avatar removed');
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Failed to remove avatar';
              showError(message);
            }
          },
        },
      ]
    );
  };

  const getAvatarUrl = () => {
    if (!user?.avatar_url) return null;
    // If it's a relative URL, prepend the API base URL
    if (user.avatar_url.startsWith('/')) {
      // Remove /api/v1 from API_BASE_URL to get the server base
      const serverBase = API_BASE_URL.replace('/api/v1', '');
      return serverBase + user.avatar_url;
    }
    return user.avatar_url;
  };

  const menuSections = [
    {
      title: 'Account',
      items: [
        {
          icon: 'person.fill',
          label: 'Edit Profile',
          color: colors.primary,
          onPress: () => setActiveModal('editProfile'),
        },
        {
          icon: 'lock.fill',
          label: 'Change Password',
          color: '#FF9500',
          onPress: () => setActiveModal('changePassword'),
        },
      ],
    },
    {
      title: 'Preferences',
      items: [
        {
          icon: 'bell.fill',
          label: 'Notifications',
          color: '#FF3B30',
          onPress: () => setActiveModal('notifications'),
        },
      ],
    },
    {
      title: 'Support',
      items: [
        {
          icon: 'questionmark.circle.fill',
          label: 'Help Center',
          color: '#34C759',
          onPress: () => setActiveModal('help'),
        },
        {
          icon: 'info.circle.fill',
          label: 'About',
          color: '#007AFF',
          onPress: () => setActiveModal('about'),
        },
      ],
    },
  ];

  const renderModalContent = () => {
    switch (activeModal) {
      case 'editProfile':
        return (
          <View style={styles.modalContent}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Profile</Text>
            
            {/* Avatar Edit */}
            <View style={styles.avatarEditSection}>
              <TouchableOpacity onPress={handlePickAvatar} activeOpacity={0.8}>
                <View style={[styles.avatarContainerLarge, { backgroundColor: colors.primary + '20' }]}>
                  {getAvatarUrl() ? (
                    <Image 
                      source={{ uri: getAvatarUrl()! }} 
                      style={styles.avatarImageLarge}
                    />
                  ) : (
                    <IconSymbol name="person.circle.fill" size={80} color={colors.primary} />
                  )}
                  <View style={[styles.avatarEditBadgeLarge, { backgroundColor: colors.primary }]}>
                    <IconSymbol name="camera.fill" size={18} color="#FFFFFF" />
                  </View>
                </View>
              </TouchableOpacity>
              <Text style={[styles.avatarHint, { color: colors.textSecondary }]}>
                Tap to change photo
              </Text>
              {user?.avatar_url && (
                <TouchableOpacity onPress={handleDeleteAvatar} style={styles.removeAvatarButton}>
                  <Text style={[styles.removeAvatarText, { color: '#FF3B30' }]}>Remove Photo</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Full Name</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.card,
                color: colors.text,
                borderColor: colors.border
              }]}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Enter your full name"
              placeholderTextColor={colors.textTertiary}
            />
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Email</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.card,
                color: colors.text,
                borderColor: colors.border
              }]}
              value={email}
              editable={false}
              placeholder="Enter your email"
              placeholderTextColor={colors.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Text style={[styles.inputHint, { color: colors.textTertiary }]}>
              Email cannot be changed
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.card }]}
                onPress={() => setActiveModal(null)}
                disabled={isSaving}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.primary, opacity: isSaving ? 0.7 : 1 }]}
                onPress={handleSaveProfile}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: '#FFFFFF' }]}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        );

      case 'changePassword':
        return (
          <View style={styles.modalContent}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Change Password</Text>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Current Password</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.card,
                color: colors.text,
                borderColor: colors.border
              }]}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Enter current password"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
            />
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>New Password</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.card,
                color: colors.text,
                borderColor: colors.border
              }]}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Enter new password"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
            />
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Confirm Password</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.card,
                color: colors.text,
                borderColor: colors.border
              }]}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.card }]}
                onPress={() => setActiveModal(null)}
                disabled={isSaving}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#FF9500', opacity: isSaving ? 0.7 : 1 }]}
                onPress={handleChangePassword}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: '#FFFFFF' }]}>Change</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        );

      case 'notifications':
        return (
          <View style={styles.modalContent}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Notifications</Text>
            <View style={[styles.settingRow, { borderColor: colors.border }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Push Notifications</Text>
                <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>Receive push notifications</Text>
              </View>
              <Switch
                value={pushNotifications}
                onValueChange={(val) => {
                  selectionImpact();
                  setPushNotifications(val);
                }}
                trackColor={{ false: colors.border, true: colors.primary + '60' }}
                thumbColor={pushNotifications ? colors.primary : '#F4F3F4'}
              />
            </View>
            <View style={[styles.settingRow, { borderColor: colors.border }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Email Notifications</Text>
                <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>Receive email updates</Text>
              </View>
              <Switch
                value={emailNotifications}
                onValueChange={(val) => {
                  selectionImpact();
                  setEmailNotifications(val);
                }}
                trackColor={{ false: colors.border, true: colors.primary + '60' }}
                thumbColor={emailNotifications ? colors.primary : '#F4F3F4'}
              />
            </View>
            <View style={[styles.settingRow, { borderColor: colors.border }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Question Generated</Text>
                <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>Notify when questions are ready</Text>
              </View>
              <Switch
                value={questionGenerated}
                onValueChange={(val) => {
                  selectionImpact();
                  setQuestionGenerated(val);
                }}
                trackColor={{ false: colors.border, true: colors.primary + '60' }}
                thumbColor={questionGenerated ? colors.primary : '#F4F3F4'}
              />
            </View>
            <View style={[styles.settingRow, { borderColor: colors.border }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Vetting Reminders</Text>
                <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>Remind to review pending questions</Text>
              </View>
              <Switch
                value={vettingReminders}
                onValueChange={(val) => {
                  selectionImpact();
                  setVettingReminders(val);
                }}
                trackColor={{ false: colors.border, true: colors.primary + '60' }}
                thumbColor={vettingReminders ? colors.primary : '#F4F3F4'}
              />
            </View>
            <TouchableOpacity
              style={[styles.modalButtonFull, { backgroundColor: colors.primary }]}
              onPress={() => setActiveModal(null)}
            >
              <Text style={[styles.modalButtonText, { color: '#FFFFFF' }]}>Done</Text>
            </TouchableOpacity>
          </View>
        );

      case 'help':
        return (
          <View style={styles.modalContent}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Help Center</Text>
            <ScrollView style={styles.helpContent}>
              <TouchableOpacity style={[styles.helpItem, { borderColor: colors.border }]}>
                <IconSymbol name="book.fill" size={24} color={colors.primary} />
                <View style={styles.helpItemContent}>
                  <Text style={[styles.helpItemTitle, { color: colors.text }]}>1. Create Subjects</Text>
                  <Text style={[styles.helpItemDesc, { color: colors.textSecondary }]}>Start by creating subjects and organizing them with topics and syllabus content</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.helpItem, { borderColor: colors.border }]}>
                <IconSymbol name="doc.badge.gearshape.fill" size={24} color="#4A90D9" />
                <View style={styles.helpItemContent}>
                  <Text style={[styles.helpItemTitle, { color: colors.text }]}>2. Create Rubrics</Text>
                  <Text style={[styles.helpItemDesc, { color: colors.textSecondary }]}>Define exam rubrics with question types, distribution, and learning outcome mapping</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.helpItem, { borderColor: colors.border }]}>
                <IconSymbol name="sparkles" size={24} color="#AF52DE" />
                <View style={styles.helpItemContent}>
                  <Text style={[styles.helpItemTitle, { color: colors.text }]}>3. Generate Questions</Text>
                  <Text style={[styles.helpItemDesc, { color: colors.textSecondary }]}>Use Rubric Generator or Quick Generate to create AI-powered questions automatically</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.helpItem, { borderColor: colors.border }]}>
                <IconSymbol name="checkmark.shield.fill" size={24} color="#34C759" />
                <View style={styles.helpItemContent}>
                  <Text style={[styles.helpItemTitle, { color: colors.text }]}>4. Vet Questions</Text>
                  <Text style={[styles.helpItemDesc, { color: colors.textSecondary }]}>Review pending questions, approve quality ones, and map to course outcomes</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.helpItem, { borderColor: colors.border }]}>
                <IconSymbol name="chart.bar.fill" size={24} color="#FF9500" />
                <View style={styles.helpItemContent}>
                  <Text style={[styles.helpItemTitle, { color: colors.text }]}>5. View Reports</Text>
                  <Text style={[styles.helpItemDesc, { color: colors.textSecondary }]}>Analyze question distribution by subject, learning outcomes, and Bloom&apos;s taxonomy</Text>
                </View>
              </TouchableOpacity>
              <View style={[styles.helpDivider, { backgroundColor: colors.border }]} />
              <Text style={[styles.helpSectionTitle, { color: colors.text }]}>What is Bloom&apos;s Taxonomy?</Text>
              <View style={[styles.bloomSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.bloomDescription, { color: colors.text }]}>
                  Bloom&apos;s Taxonomy is a framework for categorizing learning objectives and cognitive skills into six levels of increasing complexity:
                </Text>
                <View style={styles.bloomLevels}>
                  <View style={styles.bloomLevel}>
                    <View style={[styles.bloomLevelBadge, { backgroundColor: '#007AFF' }]}>
                      <Text style={styles.bloomLevelNumber}>1</Text>
                    </View>
                    <View style={styles.bloomLevelContent}>
                      <Text style={[styles.bloomLevelTitle, { color: colors.text }]}>Remember</Text>
                      <Text style={[styles.bloomLevelDesc, { color: colors.textSecondary }]}>Recall facts and basic concepts</Text>
                    </View>
                  </View>
                  <View style={styles.bloomLevel}>
                    <View style={[styles.bloomLevelBadge, { backgroundColor: '#5856D6' }]}>
                      <Text style={styles.bloomLevelNumber}>2</Text>
                    </View>
                    <View style={styles.bloomLevelContent}>
                      <Text style={[styles.bloomLevelTitle, { color: colors.text }]}>Understand</Text>
                      <Text style={[styles.bloomLevelDesc, { color: colors.textSecondary }]}>Explain ideas or concepts</Text>
                    </View>
                  </View>
                  <View style={styles.bloomLevel}>
                    <View style={[styles.bloomLevelBadge, { backgroundColor: '#34C759' }]}>
                      <Text style={styles.bloomLevelNumber}>3</Text>
                    </View>
                    <View style={styles.bloomLevelContent}>
                      <Text style={[styles.bloomLevelTitle, { color: colors.text }]}>Apply</Text>
                      <Text style={[styles.bloomLevelDesc, { color: colors.textSecondary }]}>Use information in new situations</Text>
                    </View>
                  </View>
                  <View style={styles.bloomLevel}>
                    <View style={[styles.bloomLevelBadge, { backgroundColor: '#FF9500' }]}>
                      <Text style={styles.bloomLevelNumber}>4</Text>
                    </View>
                    <View style={styles.bloomLevelContent}>
                      <Text style={[styles.bloomLevelTitle, { color: colors.text }]}>Analyze</Text>
                      <Text style={[styles.bloomLevelDesc, { color: colors.textSecondary }]}>Draw connections among concepts</Text>
                    </View>
                  </View>
                  <View style={styles.bloomLevel}>
                    <View style={[styles.bloomLevelBadge, { backgroundColor: '#FF3B30' }]}>
                      <Text style={styles.bloomLevelNumber}>5</Text>
                    </View>
                    <View style={styles.bloomLevelContent}>
                      <Text style={[styles.bloomLevelTitle, { color: colors.text }]}>Evaluate</Text>
                      <Text style={[styles.bloomLevelDesc, { color: colors.textSecondary }]}>Justify a decision or choice</Text>
                    </View>
                  </View>
                  <View style={styles.bloomLevel}>
                    <View style={[styles.bloomLevelBadge, { backgroundColor: '#AF52DE' }]}>
                      <Text style={styles.bloomLevelNumber}>6</Text>
                    </View>
                    <View style={styles.bloomLevelContent}>
                      <Text style={[styles.bloomLevelTitle, { color: colors.text }]}>Create</Text>
                      <Text style={[styles.bloomLevelDesc, { color: colors.textSecondary }]}>Produce new or original work</Text>
                    </View>
                  </View>
                </View>
                <Text style={[styles.bloomBenefit, { color: colors.textSecondary }]}>
                  Campus Learn uses Bloom&apos;s Taxonomy to generate questions at different cognitive levels, ensuring comprehensive assessment of student learning.
                </Text>
              </View>
              <View style={[styles.helpDivider, { backgroundColor: colors.border }]} />
              <Text style={[styles.helpSectionTitle, { color: colors.text }]}>Key Features</Text>
              <View style={styles.featuresList}>
                <View style={styles.featureItemHelp}>
                  <IconSymbol name="star.fill" size={16} color={colors.warning} />
                  <Text style={[styles.featureItemText, { color: colors.text }]}>Multiple question types: MCQ, Short Answer, Long Answer</Text>
                </View>
                <View style={styles.featureItemHelp}>
                  <IconSymbol name="star.fill" size={16} color={colors.warning} />
                  <Text style={[styles.featureItemText, { color: colors.text }]}>Bloom&apos;s Taxonomy support for cognitive levels</Text>
                </View>
                <View style={styles.featureItemHelp}>
                  <IconSymbol name="star.fill" size={16} color={colors.warning} />
                  <Text style={[styles.featureItemText, { color: colors.text }]}>Learning outcome mapping and tracking</Text>
                </View>
                <View style={styles.featureItemHelp}>
                  <IconSymbol name="star.fill" size={16} color={colors.warning} />
                  <Text style={[styles.featureItemText, { color: colors.text }]}>Real-time analytics and coverage reports</Text>
                </View>
              </View>
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalButtonFull, { backgroundColor: colors.primary }]}
              onPress={() => setActiveModal(null)}
            >
              <Text style={[styles.modalButtonText, { color: '#FFFFFF' }]}>Done</Text>
            </TouchableOpacity>
          </View>
        );

      case 'about':
        return (
          <View style={styles.modalContent}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>About</Text>
            <View style={styles.aboutHeader}>
              <View style={[styles.aboutIconContainer, { backgroundColor: colors.primary + '20' }]}>
                <IconSymbol name="sparkles" size={48} color={colors.primary} />
              </View>
              <Text style={[styles.aboutAppName, { color: colors.text }]}>Campus Learn</Text>
              <Text style={[styles.aboutVersion, { color: colors.textSecondary }]}>Version 1.0.0</Text>
            </View>
            <View style={[styles.aboutSection, { borderColor: colors.border }]}>
              <Text style={[styles.aboutSectionTitle, { color: colors.textSecondary }]}>ABOUT</Text>
              <Text style={[styles.aboutText, { color: colors.text }]}>
                Campus Learn is an intelligent learning platform powered by advanced AI.
                Generate high-quality examination questions from your course materials instantly.
              </Text>
            </View>
            <View style={[styles.aboutSection, { borderColor: colors.border }]}>
              <Text style={[styles.aboutSectionTitle, { color: colors.textSecondary }]}>FEATURES</Text>
              <View style={styles.featureList}>
                <View style={styles.featureItem}>
                  <IconSymbol name="checkmark.circle.fill" size={16} color={colors.success} />
                  <Text style={[styles.featureText, { color: colors.text }]}>AI-Powered Question Generation</Text>
                </View>
                <View style={styles.featureItem}>
                  <IconSymbol name="checkmark.circle.fill" size={16} color={colors.success} />
                  <Text style={[styles.featureText, { color: colors.text }]}>Multiple Question Types</Text>
                </View>
                <View style={styles.featureItem}>
                  <IconSymbol name="checkmark.circle.fill" size={16} color={colors.success} />
                  <Text style={[styles.featureText, { color: colors.text }]}>Question Vetting Workflow</Text>
                </View>
                <View style={styles.featureItem}>
                  <IconSymbol name="checkmark.circle.fill" size={16} color={colors.success} />
                  <Text style={[styles.featureText, { color: colors.text }]}>Bloom&apos;s Taxonomy Support</Text>
                </View>
              </View>
            </View>
            <Text style={[styles.copyright, { color: colors.textTertiary }]}>
              © {new Date().getFullYear()} Campus Learn. All rights reserved.
            </Text>
            <TouchableOpacity
              style={[styles.modalButtonFull, { backgroundColor: colors.primary }]}
              onPress={() => setActiveModal(null)}
            >
              <Text style={[styles.modalButtonText, { color: '#FFFFFF' }]}>Done</Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile Header */}
      <GlassCard style={styles.headerCard}>
        <TouchableOpacity onPress={handlePickAvatar} onLongPress={user?.avatar_url ? handleDeleteAvatar : undefined} activeOpacity={0.8}>
          <View style={[styles.avatarContainer, { backgroundColor: colors.primary + '20' }]}>
            {getAvatarUrl() ? (
              <Image 
                source={{ uri: getAvatarUrl()! }} 
                style={styles.avatarImage}
              />
            ) : (
              <IconSymbol name="person.circle.fill" size={64} color={colors.primary} />
            )}
            <View style={[styles.avatarEditBadge, { backgroundColor: colors.primary }]}>
              <IconSymbol name="camera.fill" size={14} color="#FFFFFF" />
            </View>
          </View>
        </TouchableOpacity>
        <Text style={[styles.userName, { color: colors.text }]}>
          {user?.full_name || user?.username || 'User'}
        </Text>
        <Text style={[styles.userEmail, { color: colors.textSecondary }]}>
          {user?.email || 'user@example.com'}
        </Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.primary }]}>{totalQuestions}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Questions</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.success }]}>{approvedQuestions}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Approved</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: '#FF9500' }]}>{totalSubjects}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Subjects</Text>
          </View>
        </View>
      </GlassCard>

      {/* Menu Sections */}
      {menuSections.map((section, sectionIndex) => (
        <View key={sectionIndex} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {section.title}
          </Text>
          <GlassCard style={styles.menuCard}>
            {section.items.map((item: any, itemIndex: number) => (
              <TouchableOpacity
                key={itemIndex}
                style={[
                  styles.menuItem,
                  itemIndex < section.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }
                ]}
                onPress={item.onPress}
                activeOpacity={0.7}
              >
                <View style={[styles.menuIconContainer, { backgroundColor: item.color + '20' }]}>
                  <IconSymbol name={item.icon as any} size={20} color={item.color} />
                </View>
                <Text style={[styles.menuItemText, { color: colors.text }]}>{item.label}</Text>
                <IconSymbol name="chevron.right" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}
          </GlassCard>
        </View>
      ))}

      {/* Logout Button */}
      <View style={styles.logoutContainer}>
        <TouchableOpacity
          style={[styles.logoutButton, { backgroundColor: '#FF3B30' + '15' }]}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <IconSymbol name="rectangle.portrait.and.arrow.right.fill" size={20} color="#FF3B30" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Version */}
      <Text style={[styles.versionText, { color: colors.textTertiary }]}>
        Campus Learn v1.0.0
      </Text>

      {/* Bottom padding for floating tab bar */}
      <View style={{ height: 100 }} />

      {/* Modal */}
      <Modal
        visible={activeModal !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.closeButton}>
              <IconSymbol name="xmark.circle.fill" size={28} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
          {renderModalContent()}
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingTop: Spacing.xl,
  },
  headerCard: {
    marginHorizontal: Spacing.lg,
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  avatarContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
    position: 'relative',
  },
  avatarImage: {
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  avatarEditSection: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  avatarContainerLarge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  avatarImageLarge: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  avatarEditBadgeLarge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  avatarHint: {
    fontSize: FontSizes.sm,
    marginTop: Spacing.sm,
  },
  removeAvatarButton: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  removeAvatarText: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  inputHint: {
    fontSize: FontSizes.xs,
    marginTop: Spacing.xs,
  },
  userName: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
  },
  userEmail: {
    fontSize: FontSizes.sm,
    marginTop: Spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128, 128, 128, 0.2)',
    width: '100%',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: FontSizes.xs,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
  },
  section: {
    marginTop: Spacing.xl,
  },
  sectionTitle: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  menuCard: {
    marginHorizontal: Spacing.lg,
    paddingVertical: 0,
    paddingHorizontal: 0,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  menuItemText: {
    fontSize: FontSizes.md,
    fontWeight: '500',
    flex: 1,
  },
  logoutContainer: {
    marginTop: Spacing.xxl,
    marginHorizontal: Spacing.lg,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    gap: Spacing.sm,
  },
  logoutText: {
    fontSize: FontSizes.md,
    fontWeight: '600',
    color: '#FF3B30',
  },
  versionText: {
    fontSize: FontSizes.xs,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },

  // Modal Styles
  modalContainer: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 20 : 0,
  },
  modalHeader: {
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  closeButton: {
    padding: Spacing.xs,
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  modalTitle: {
    fontSize: FontSizes.xxl,
    fontWeight: '700',
    marginBottom: Spacing.lg,
  },
  modalSubtitle: {
    fontSize: FontSizes.sm,
    marginBottom: Spacing.lg,
  },
  inputLabel: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSizes.md,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.xl,
  },
  modalButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  modalButtonFull: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    marginTop: Spacing.xl,
  },
  modalButtonText: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },

  // Settings Row
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  settingInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  settingLabel: {
    fontSize: FontSizes.md,
    fontWeight: '500',
  },
  settingDesc: {
    fontSize: FontSizes.xs,
    marginTop: 2,
  },

  // Theme Options
  themeOptions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    borderRadius: BorderRadius.lg,
    position: 'relative',
  },
  themeLabel: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
    marginTop: Spacing.sm,
  },
  themeCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  modalNote: {
    fontSize: FontSizes.xs,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },

  // Help Items
  helpContent: {
    maxHeight: 500,
  },
  helpItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    gap: Spacing.md,
  },
  helpItemContent: {
    flex: 1,
  },
  helpItemTitle: {
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  helpItemDesc: {
    fontSize: FontSizes.sm,
    marginTop: Spacing.xs,
    lineHeight: 18,
  },
  helpDivider: {
    height: 1,
    marginVertical: Spacing.lg,
  },
  helpSectionTitle: {
    fontSize: FontSizes.md,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  featuresList: {
    gap: Spacing.sm,
  },
  featureItemHelp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  featureItemText: {
    fontSize: FontSizes.sm,
    flex: 1,
    lineHeight: 18,
  },
  bloomSection: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  bloomDescription: {
    fontSize: FontSizes.sm,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  bloomLevels: {
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  bloomLevel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  bloomLevelBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bloomLevelNumber: {
    color: '#FFFFFF',
    fontSize: FontSizes.sm,
    fontWeight: '700',
  },
  bloomLevelContent: {
    flex: 1,
  },
  bloomLevelTitle: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  bloomLevelDesc: {
    fontSize: FontSizes.xs,
    marginTop: 2,
  },
  bloomBenefit: {
    fontSize: FontSizes.xs,
    fontStyle: 'italic',
    lineHeight: 16,
  },

  // About
  aboutHeader: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  aboutIconContainer: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  aboutAppName: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
  },
  aboutVersion: {
    fontSize: FontSizes.sm,
    marginTop: Spacing.xs,
  },
  aboutSection: {
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    marginBottom: Spacing.md,
  },
  aboutSectionTitle: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
    marginBottom: Spacing.sm,
  },
  aboutText: {
    fontSize: FontSizes.sm,
    lineHeight: 20,
  },
  featureList: {
    gap: Spacing.sm,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  featureText: {
    fontSize: FontSizes.sm,
  },
  copyright: {
    fontSize: FontSizes.xs,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
});
