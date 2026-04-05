/**
 * Debug Connectivity Screen
 * Temporary screen for testing network connectivity
 */

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { testConnectivity, testApiEndpoint } from '@/utils/connectivity';
import { API_BASE_URL } from '@/services/api';

export default function DebugConnectivityScreen() {
  const [healthStatus, setHealthStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [apiStatus, setApiStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const testHealth = async () => {
    setHealthStatus('testing');
    addLog('Testing health endpoint...');
    
    try {
      const result = await testConnectivity();
      setHealthStatus(result ? 'success' : 'failed');
      addLog(`Health test ${result ? 'PASSED' : 'FAILED'}`);
    } catch (error) {
      setHealthStatus('failed');
      addLog(`Health test ERROR: ${error}`);
    }
  };

  const testApi = async () => {
    setApiStatus('testing');
    addLog('Testing API endpoint...');
    
    try {
      const result = await testApiEndpoint();
      setApiStatus(result ? 'success' : 'failed');
      addLog(`API test ${result ? 'PASSED' : 'FAILED'}`);
    } catch (error) {
      setApiStatus('failed');
      addLog(`API test ERROR: ${error}`);
    }
  };

  useEffect(() => {
    addLog(`API Base URL: ${API_BASE_URL}`);
    addLog('Debug connectivity screen loaded');
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return '#4CAF50';
      case 'failed': return '#F44336';
      case 'testing': return '#FF9800';
      default: return '#757575';
    }
  };

  const clearLogs = () => {
    setLogs([]);
    addLog('Logs cleared');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connectivity Debug</Text>
      
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>API Base URL:</Text>
        <Text style={styles.urlText}>{API_BASE_URL}</Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: getStatusColor(healthStatus) }]}
          onPress={testHealth}
          disabled={healthStatus === 'testing'}
        >
          <Text style={styles.buttonText}>
            {healthStatus === 'testing' ? 'Testing...' : `Test Health (${healthStatus})`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: getStatusColor(apiStatus) }]}
          onPress={testApi}
          disabled={apiStatus === 'testing'}
        >
          <Text style={styles.buttonText}>
            {apiStatus === 'testing' ? 'Testing...' : `Test API (${apiStatus})`}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.button, styles.clearButton]} onPress={clearLogs}>
          <Text style={styles.buttonText}>Clear Logs</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.logContainer}>
        <Text style={styles.logTitle}>Debug Logs:</Text>
        <ScrollView style={styles.logScroll} nestedScrollEnabled={true}>
          {logs.map((log, index) => (
            <Text key={index} style={styles.logText}>{log}</Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: '#e3f2fd',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  infoText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 5,
  },
  urlText: {
    fontSize: 14,
    color: '#1976d2',
    fontFamily: 'monospace',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
    gap: 10,
  },
  button: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  clearButton: {
    backgroundColor: '#757575',
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
  },
  logContainer: {
    flex: 1,
    backgroundColor: '#263238',
    borderRadius: 8,
    padding: 15,
  },
  logTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  logScroll: {
    flex: 1,
  },
  logText: {
    color: '#4CAF50',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
});
