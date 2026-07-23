'use client';

import React, { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Upload, Download, Play, FileText, Loader2, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { fetchDeployments, getDeployedModelIds } from '@/lib/deployment-utils';
import { DeploymentBadge } from '@/components/badge-components';

interface DeployedModel {
  model_name: string;
  status: string;
  deployment_status: string;
}

interface BatchTask {
  task_id: string;
  status: string;
  message?: string;
  final_file_path?: string;
  progress?: {
    lines_processed: number;
    batches_sent: number;
    current_buffer_size: number;
  };
  performance?: {
    elapsed_seconds: number;
    lines_per_second: number;
  };
  started_at?: number;
}

export default function BatchInferencePage() {
  const { isSignedIn, isLoaded } = useUser();
  const [selectedModel, setSelectedModel] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreviewData, setCsvPreviewData] = useState<string[][]>([]);
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI assistant.');
  const [results, setResults] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deployedModels, setDeployedModels] = useState<DeployedModel[]>([]);
  const [currentTask, setCurrentTask] = useState<BatchTask | null>(null);
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const [maxTokens, setMaxTokens] = useState(100);
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [topK, setTopK] = useState<number | undefined>(undefined);
  const [minP, setMinP] = useState<number | undefined>(undefined);
  const [minTokens, setMinTokens] = useState<number | undefined>(undefined);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [frequencyPenalty, setFrequencyPenalty] = useState<number | undefined>(undefined);
  const [repetitionPenalty, setRepetitionPenalty] = useState<number | undefined>(undefined);
  const [presencePenalty, setPresencePenalty] = useState<number | undefined>(undefined);
  const [stopSequences, setStopSequences] = useState<string>('');
  const [columnName, setColumnName] = useState('prompt');
  const [saveResultsPath, setSaveResultsPath] = useState('s3://o3c-results/');
  const [maxBufferSize, setMaxBufferSize] = useState(1000);
  const [minBufferSize, setMinBufferSize] = useState(500);
  
  // Upload progress states
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  
  // UI flow states
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  
  // Deployment status tracking
  const [deployedModelIds, setDeployedModelIds] = useState<Set<string>>(new Set());
  const [isRefreshingDeployments, setIsRefreshingDeployments] = useState(false);

  const fetchDeployedModels = async () => {
    setIsRefreshingDeployments(true);
    try {
      const deployments = await fetchDeployments();
      const deployedIds = getDeployedModelIds(deployments);
      setDeployedModelIds(deployedIds);
      
      // Convert to DeployedModel format for compatibility
      const models = deployments
        .filter(d => d.status === 'ready')
        .map(d => ({
          model_name: d.model_name,
          status: d.status,
          deployment_status: 'deployed'
        }));
      
      setDeployedModels(models);
      
      // Set default model to first deployed model if none selected
      if (models.length > 0 && !selectedModel) {
        setSelectedModel(models[0].model_name);
      }
      
      console.log('Deployed models:', Array.from(deployedIds));
    } catch (error) {
      console.error('Failed to fetch deployed models:', error);
      setDeployedModels([]);
    } finally {
      setIsRefreshingDeployments(false);
    }
  };

  // Fetch deployed models on component mount
  useEffect(() => {
    fetchDeployedModels();
  }, []);

  // Show loading state while checking authentication
  if (!isLoaded) {
    return <div className="flex justify-center items-center min-h-screen">Loading...</div>;
  }

  // Show sign-in prompt for unauthenticated users
  if (!isSignedIn) {
    return <SignInPrompt pageType="batch-inference" />;
  }

  const handleProcessBatch = async () => {
    if (!selectedModel || !csvFile) return;

    setIsProcessing(true);
    setIsUploading(true);
    setUploadProgress(0);
    setUploadComplete(false);
    setCurrentTask(null);
    
    try {
      await handleCSVBatchProcessing();
    } catch (error) {
      console.error('Batch processing failed:', error);
      setResults([`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    } finally {
      setIsProcessing(false);
      setIsUploading(false);
    }
  };

  const uploadFileToS3WithProgress = async (file: File): Promise<string | null> => {
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', file);

      // Use server-sent events for real S3 progress tracking
      return new Promise((resolve, reject) => {
        // Send the file to the S3 upload endpoint with progress tracking
        fetch('/api/upload-to-s3', {
          method: 'POST',
          body: formData,
        })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          
          if (!response.body) {
            throw new Error('No response body');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          const readStream = () => {
            reader.read().then(({ done, value }) => {
              if (done) {
                return;
              }

              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    
                    if (data.type === 'progress') {
                      setUploadProgress(data.progress);
                    } else if (data.type === 'complete') {
                      console.log(`File uploaded successfully to: ${data.s3Path}`);
                      console.log(`File size: ${(data.fileSize / 1024).toFixed(1)} KB`);
                      resolve(data.s3Path);
                      return;
                    } else if (data.type === 'error') {
                      reject(new Error(data.error));
                      return;
                    }
                  } catch (parseError) {
                    console.warn('Failed to parse SSE data:', line);
                  }
                }
              }

              readStream();
            }).catch(reject);
          };

          readStream();
        })
        .catch(reject);
      });
      
    } catch (error) {
      console.error('S3 upload error:', error);
      
      // Provide user-friendly error messages
      if (error instanceof Error) {
        if (error.message.includes('CSV')) {
          throw new Error('Please upload a valid CSV file');
        } else if (error.message.includes('size')) {
          throw new Error('File size error occurred during upload');
        } else if (error.message.includes('credentials')) {
          throw new Error('Server configuration error. Please contact support');
        } else {
          throw error;
        }
      }
      
      throw new Error('Unknown upload error');
    }
  };

  const handleCSVBatchProcessing = async () => {
    if (!csvFile) return;

    // Step 1: Upload CSV file to S3 with progress tracking
    const s3FilePath = await uploadFileToS3WithProgress(csvFile);
    if (!s3FilePath) {
      throw new Error('Failed to upload file to S3');
    }

    setIsUploading(false);
    setUploadComplete(true);

    setCurrentTask({ task_id: '', status: 'starting', message: 'Starting batch inference...' });
    
    const response = await fetch('/api/batch-inference', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_name: selectedModel,
        path_of_csv: s3FilePath,
        name_of_column: selectedColumn,
        delimiter: ",",
        system_prompt: systemPrompt,
        max_buffer_size: maxBufferSize,
        min_buffer_size: minBufferSize,
        dry_run: false,
        max_completion_tokens: maxTokens,
        temperature: temperature,
        top_p: topP,
        ...(topK !== undefined && { top_k: topK }),
        ...(minP !== undefined && { min_p: minP }),
        ...(minTokens !== undefined && { min_tokens: minTokens }),
        ...(seed !== undefined && { seed: seed }),
        ...(frequencyPenalty !== undefined && { frequency_penalty: frequencyPenalty }),
        ...(repetitionPenalty !== undefined && { repetition_penalty: repetitionPenalty }),
        ...(presencePenalty !== undefined && { presence_penalty: presencePenalty }),
        ...(stopSequences && stopSequences.trim() && { stop: stopSequences.split(',').map(s => s.trim()).filter(s => s) }),
        path_to_save_results: saveResultsPath,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to start batch processing: ${response.statusText}`);
    }

    const result = await response.json();
    setCurrentTask(result);
    
    // Poll for task status
    if (result.task_id) {
      pollTaskStatus(result.task_id);
    }
  };

  const pollTaskStatus = async (taskId: string) => {
    const maxPolls = 60; // Poll for up to 5 minutes
    let polls = 0;
    
    const poll = async () => {
      if (polls >= maxPolls) {
        setResults(['Error: Task polling timeout']);
        return;
      }
      
      try {
        const response = await fetch(`/api/batch-inference/status/${taskId}`);
        if (response.ok) {
          const status = await response.json();
          console.log('Updated task status:', status);
          setCurrentTask(status);
          
          if (status.status === 'completed') {
            setResults(['Batch processing completed successfully! Your results file is ready for download.']);
            setIsProcessing(false);
            return;
          } else if (status.status === 'failed') {
            setResults([`Batch processing failed: ${status.error || 'Unknown error'}`]);
            setIsProcessing(false);
            return;
          }
        } else {
          const errorData = await response.json();
          console.error('Task status error:', errorData);
          if (response.status === 503) {
            setResults(['Error: Cannot connect to batch inference server. Please try again later.']);
            return;
          }
        }
      } catch (error) {
        console.error('Failed to poll task status:', error);
      }
      
      polls++;
      setTimeout(poll, 5000); // Poll every 5 seconds
    };
    
    poll();
  };


  const parseCSVPreview = (csvText: string): string[][] => {
    try {
      const lines = csvText.split(/\r?\n/).filter(line => line.trim());
      if (lines.length === 0) return [];
      
      let completeLines = [];
      let currentLine = '';
      let inQuotes = false;
      
      for (const line of lines) {
        currentLine += line;
        
        // Count quotes to determine if we're in a multi-line field
        for (const char of line) {
          if (char === '"') {
            inQuotes = !inQuotes;
          }
        }
        
        if (!inQuotes) {
          completeLines.push(currentLine);
          currentLine = '';
          
          // Stop once we have enough lines for preview
          if (completeLines.length >= 6) break;
        } else {
          // Add newline back for multi-line fields
          currentLine += '\n';
        }
      }
      
      // If we didn't get enough complete lines, use what we have
      if (completeLines.length === 0 && currentLine) {
        completeLines = [currentLine];
      }
      
      const result = completeLines.map(line => {
        // Simple CSV parsing - handles basic cases
        const fields = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
              // Handle escaped quotes
              current += '"';
              i++; // Skip next quote
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            fields.push(current.trim().replace(/^"|"$/g, ''));
            current = '';
          } else {
            current += char;
          }
        }
        fields.push(current.trim().replace(/^"|"$/g, '')); 
        return fields;
      });
      
      // Ensure all rows have the same number of columns as the header
      if (result.length > 0) {
        const headerLength = result[0].length;
        return result.map(row => {
          while (row.length < headerLength) {
            row.push('');
          }
          return row.slice(0, headerLength); 
        });
      }
      
      return result;
    } catch (error) {
      console.error('CSV parsing error:', error);
      return [];
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Reset states
    setPreviewError(null);
    setCsvPreviewData([]);
    setSelectedColumn('');
    setShowConfigForm(false);
    
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      setPreviewError('Please select a valid CSV file');
      return;
    }
    
      setCsvFile(file);
    setIsLoadingPreview(true);
    
    // Add timeout for very large files
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('File processing timeout')), 30000); // 30 second timeout
    });
    
    try {
      // For large files, only read the first portion needed for preview
      const maxPreviewSize = 200 * 1024; // 200KB should be enough for preview of wide CSVs
      let text: string;
      
      const readFilePromise = (async () => {
        if (file.size > maxPreviewSize) {
          // Read only the first portion for large files
          const blob = file.slice(0, maxPreviewSize);
          const result = await blob.text();
          console.log(`Large file detected (${(file.size / 1024 / 1024).toFixed(1)}MB). Reading first ${maxPreviewSize / 1024}KB for preview.`);
          return result;
        } else {
          // Read entire file for smaller files
          const result = await file.text();
          console.log('File content length:', result.length);
          return result;
        }
      })();
      
      text = await Promise.race([readFilePromise, timeoutPromise]) as string;
      
      if (!text.trim()) {
        setPreviewError('The CSV file appears to be empty');
        return;
      }
      
      const previewData = parseCSVPreview(text);
      console.log('Preview data:', previewData);
      
      if (previewData.length === 0) {
        setPreviewError('Could not parse CSV data');
        return;
      }
      
      if (previewData[0].length === 0) {
        setPreviewError('No columns found in CSV file');
        return;
      }
      
      setCsvPreviewData(previewData);
      
      // Estimate total lines for progress tracking
      // For large files, we can't get exact count, so we'll estimate based on file size
      if (file.size > maxPreviewSize) {
        // Rough estimation: assume average line is ~100 characters
        const estimatedLines = Math.max(200, Math.floor(file.size / 100));
        setTotalLines(estimatedLines);
        console.log(`Large file detected. Estimated total lines: ${estimatedLines}`);
      } else {
        // For smaller files, we can get a more accurate count
        const fullText = await file.text();
        const lineCount = fullText.split(/\r?\n/).filter(line => line.trim()).length;
        setTotalLines(lineCount);
        console.log(`Total lines in CSV: ${lineCount}`);
      }
      
      setShowConfigForm(true);
    } catch (error) {
      console.error('Error reading CSV file:', error);
      if (error instanceof Error && error.message === 'File processing timeout') {
        setPreviewError(`File is too large to process quickly (${(file.size / 1024 / 1024).toFixed(1)}MB). The preview timed out, but you can still proceed with batch processing.`);
      } else {
        setPreviewError('Error reading CSV file. Please check the file format.');
      }
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleDownloadResults = () => {
    const blob = new Blob([results.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'batch-inference-results.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadFinalResults = async () => {
    if (!currentTask?.task_id) return;
    
    // Show loading state
    setResults(['Preparing download... This may take a moment while we wait for the file to be uploaded.']);
    
    try {
      const response = await fetch(`/api/batch-inference/download/${currentTask.task_id}`);
      
      if (response.status === 202) {
        // 202 means file is still being uploaded
        const data = await response.json();
        setResults([
          'Processing complete! 🎉',
          '',
          'The results file is currently being uploaded to S3.',
          'This usually takes a few moments.',
          '',
          'Please try downloading again in 10-30 seconds.',
        ]);
        return;
      }
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Download error:', errorData);
        
        // Provide more helpful error messages
        let errorMessage = 'Error downloading results: ';
        if (errorData.status === 'uploading' || errorData.error?.includes('being uploaded')) {
          errorMessage = 'Processing complete! The results file is currently being uploaded to S3. Please try again in a few moments.';
        } else if (errorData.error?.includes('after multiple attempts')) {
          errorMessage += 'The file is taking longer than expected to upload. Please try again in a few moments.';
        } else if (errorData.error?.includes('No results found') || errorData.error?.includes('No output file')) {
          errorMessage += 'The results file was not found. This may be a temporary issue - please try again.';
        } else {
          errorMessage += errorData.message || errorData.error || 'Unknown error';
        }
        
        setResults([errorMessage]);
        return;
      }
      
      // Get the filename from the Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'batch_results.csv';
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }
      
      // Create blob and download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      
      // Show success message
      setResults([`Successfully downloaded: ${filename}`]);
      
    } catch (error) {
      console.error('Failed to download results:', error);
      setResults([`Error downloading results: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Batch Inference</h1>
        <p className="text-muted-foreground">
            Process multiple inputs simultaneously with your chosen model. Upload a CSV file and configure your batch processing settings.
        </p>
      </div>

      <div className="space-y-8">
        {/* Step 1: File Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Step 1: Upload CSV File
            </CardTitle>
            <CardDescription>
              Upload your CSV file to get started with batch processing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Button variant="outline" asChild className="cursor-pointer">
                  <label>
                    <Upload className="h-4 w-4 mr-2" />
                    Choose CSV File
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </Button>
                <span className="text-sm text-muted-foreground">
                  Select a CSV file for batch processing
                </span>
              </div>
              {isLoadingPreview && (
                <div className="flex items-center gap-2 p-3 bg-accent/10 rounded-md border border-accent/20">
                  <Loader2 className="h-4 w-4 text-accent animate-spin" />
                  <span className="text-sm text-accent">
                    Processing CSV file...
                  </span>
                </div>
              )}
              
              {previewError && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-md border border-destructive/20">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <span className="text-sm text-destructive">
                      {previewError}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => {
                        setPreviewError(null);
                        setCsvFile(null);
                        // Reset the file input
                        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
                        if (fileInput) fileInput.value = '';
                      }}
                    >
                      Try Another File
                    </Button>
                    {previewError.includes('too large') && (
                      <Button 
                        variant="default" 
                        size="sm" 
                        onClick={() => {
                          setPreviewError(null);
                          setShowConfigForm(true);
                          // For large files, we'll show a manual column input instead of preview
                        }}
                      >
                        Skip Preview & Continue
                      </Button>
                    )}
                  </div>
                </div>
              )}
              
              {csvFile && !isLoadingPreview && !previewError && (
                <div className="flex items-center gap-2 p-3 bg-accent/10 rounded-md border border-accent/20">
                  <CheckCircle className="h-4 w-4 text-accent" />
                  <span className="text-sm text-accent">
                    File uploaded: {csvFile.name} ({(csvFile.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Step 2: CSV Preview and Column Selection */}
        {showConfigForm && csvPreviewData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Step 2: Select Input Column
              </CardTitle>
              <CardDescription>
                Preview your CSV data and select the column containing the input text
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="overflow-x-auto csv-table-scroll">
                  <table className="w-full border-collapse border border-border text-sm rounded-lg overflow-hidden shadow-sm bg-card">
                    <thead>
                      <tr className="bg-muted/50">
                        {csvPreviewData[0]?.map((header, index) => (
                          <th 
                            key={index} 
                            className={`border-r border-border p-3 text-left cursor-pointer transition-all duration-150 ease-out relative group ${
                              selectedColumn === header 
                                ? 'text-accent bg-accent/15 shadow-md border-t-2 border-t-accent border-l-2 border-l-accent border-r-2 border-r-accent' 
                                : 'text-muted-foreground hover:text-accent hover:bg-accent/8 hover:shadow-sm'
                            }`}
                            onClick={() => setSelectedColumn(header)}
                          >
                            <div className="flex items-center gap-2">
                              {selectedColumn === header && (
                                <CheckCircle className="h-4 w-4 text-accent" />
                              )}
                              <span className="font-semibold text-sm">{header}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreviewData.slice(1).map((row, rowIndex) => (
                        <tr key={rowIndex} className="hover:bg-muted/20 transition-colors duration-150 ease-out">
                          {row.map((cell, cellIndex) => {
                            const isSelected = selectedColumn === csvPreviewData[0][cellIndex];
                            const isLastRow = rowIndex === csvPreviewData.slice(1).length - 1;
                            return (
                              <td 
                                key={cellIndex} 
                                className={`border-r border-border p-3 max-w-xs truncate text-foreground relative transition-all duration-150 ease-out ${
                                  isSelected 
                                    ? `bg-accent/8 border-l-2 border-l-accent border-r-2 border-r-accent ${isLastRow ? 'border-b-2 border-b-accent' : ''} shadow-sm` 
                                    : 'bg-card hover:bg-accent/4'
                                }`}
                                title={cell}
                              >
                                <span className="text-sm">{cell}</span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selectedColumn && (
                  <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-accent/10 to-primary/10 rounded-lg border border-accent/30 shadow-sm">
                    <div className="flex-shrink-0">
                      <CheckCircle className="h-5 w-5 text-accent" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">
                        Selected Column: <span className="font-bold text-accent">{selectedColumn}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        This column will be used as input for batch processing
                      </p>
                    </div>
                  </div>
                )}
                {!selectedColumn && (
                  <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-border">
                    <div className="flex-shrink-0">
                      <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Click on a column header above to select it as your input column
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Configuration Form */}
        {showConfigForm && (selectedColumn || csvPreviewData.length === 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Step 3: Configure Batch Processing
              </CardTitle>
              <CardDescription>
                Set up your model and processing parameters
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Manual Column Input for Large Files */}
              {csvPreviewData.length === 0 && (
                <div className="p-4 bg-primary/10 rounded-md border border-primary/20">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-primary mt-0.5" />
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium text-primary">Large File Detected</p>
                        <p className="text-sm text-primary/80">
                          Preview is not available for this large file. Please manually enter the column name containing your input text.
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">CSV Column Name</label>
                        <Input
                          placeholder="Enter column name (e.g., prompt, text, input)"
                          value={selectedColumn}
                          onChange={(e) => setSelectedColumn(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Enter the exact name of the column containing the input text in your CSV file
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Model Selection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Model Name</label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchDeployedModels}
                    disabled={isRefreshingDeployments}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshingDeployments ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                {deployedModels.length > 0 ? (
                  <Select 
                    value={selectedModel} 
                    onValueChange={(modelId) => {
                      // Check if model is deployed before allowing selection
                      if (!deployedModelIds.has(modelId)) {
                        alert('⚠️ This model is not currently deployed. Please select a deployed model or refresh deployment status.');
                        return;
                      }
                      setSelectedModel(modelId);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a deployed model for batch processing" />
                    </SelectTrigger>
                    <SelectContent>
                      {deployedModels.map((model) => {
                        const isDeployed = deployedModelIds.has(model.model_name);
                        return (
                          <SelectItem 
                            key={model.model_name} 
                            value={model.model_name}
                            disabled={!isDeployed}
                            className={!isDeployed ? 'opacity-50 cursor-not-allowed' : ''}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span>{model.model_name}</span>
                              <DeploymentBadge 
                                status={isDeployed ? 'ready' : 'not-deployed'} 
                                className="ml-2"
                              />
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-2">
                    <Input
                      placeholder="Enter model name (e.g., casperhansen/llama-3.3-70b-instruct-awq)"
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                    />
                    <p className="text-sm text-accent">
                      <AlertCircle className="h-4 w-4 inline mr-1" />
                      No deployed models found. Enter the exact model name as deployed on your backend server or click Refresh.
                    </p>
                  </div>
                )}
              </div>

              {/* System Prompt */}
              <div>
                <label className="text-sm font-medium mb-2 block">System Prompt</label>
                <Input
                  placeholder="Enter system prompt (e.g., You are a helpful AI assistant)"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              </div>

              {/* Save Results Path */}
              <div>
                <label className="text-sm font-medium mb-2 block">Results Save Path</label>
                <Input
                  placeholder="s3://o3c-results/my-project/"
                  value={saveResultsPath}
                  onChange={(e) => setSaveResultsPath(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  S3 path where the final results file will be saved
                </p>
              </div>

              {/* Buffer Size Controls */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Max Buffer Size</label>
                  <Input
                    type="number"
                    placeholder="1000"
                    value={maxBufferSize}
                    onChange={(e) => setMaxBufferSize(parseInt(e.target.value) || 1000)}
                    min="1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Maximum batch size for processing
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Min Buffer Size</label>
                  <Input
                    type="number"
                    placeholder="500"
                    value={minBufferSize}
                    onChange={(e) => setMinBufferSize(parseInt(e.target.value) || 500)}
                    min="1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum batch size for processing
                  </p>
                </div>
              </div>

              {/* Sampling Parameters Section */}
              <div className="pt-4 border-t">
                <h4 className="text-sm font-semibold mb-3">Sampling Parameters</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  {/* Max Tokens */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Max Tokens</label>
                    <Input
                      type="number"
                      placeholder="100"
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(parseInt(e.target.value) || 100)}
                      min="1"
                      max="4096"
                    />
                  </div>

                  {/* Temperature */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Temperature</label>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="0.7"
                      value={temperature}
                      onChange={(e) => setTemperature(parseFloat(e.target.value) || 0.7)}
                      min="0"
                      max="2"
                    />
                  </div>

                  {/* Top P */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Top P</label>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="0.9"
                      value={topP}
                      onChange={(e) => setTopP(parseFloat(e.target.value) || 0.9)}
                      min="0"
                      max="1"
                    />
                  </div>

                  {/* Top K */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Top K (optional)</label>
                    <Input
                      type="number"
                      placeholder="50"
                      value={topK || ''}
                      onChange={(e) => setTopK(e.target.value ? parseInt(e.target.value) : undefined)}
                      min="1"
                    />
                  </div>

                  {/* Min P */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Min P (optional)</label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.05"
                      value={minP || ''}
                      onChange={(e) => setMinP(e.target.value ? parseFloat(e.target.value) : undefined)}
                      min="0"
                      max="1"
                    />
                  </div>

                  {/* Min Tokens */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Min Tokens (optional)</label>
                    <Input
                      type="number"
                      placeholder="1"
                      value={minTokens || ''}
                      onChange={(e) => setMinTokens(e.target.value ? parseInt(e.target.value) : undefined)}
                      min="1"
                    />
                  </div>

                  {/* Seed */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Seed (optional)</label>
                    <Input
                      type="number"
                      placeholder="42"
                      value={seed || ''}
                      onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : undefined)}
                    />
                  </div>

                  {/* Frequency Penalty */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Frequency Penalty (optional)</label>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="0.0"
                      value={frequencyPenalty || ''}
                      onChange={(e) => setFrequencyPenalty(e.target.value ? parseFloat(e.target.value) : undefined)}
                      min="-2"
                      max="2"
                    />
                  </div>

                  {/* Repetition Penalty */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Repetition Penalty (optional)</label>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="1.0"
                      value={repetitionPenalty || ''}
                      onChange={(e) => setRepetitionPenalty(e.target.value ? parseFloat(e.target.value) : undefined)}
                      min="0.1"
                      max="2"
                    />
                  </div>

                  {/* Presence Penalty */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Presence Penalty (optional)</label>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="0.0"
                      value={presencePenalty || ''}
                      onChange={(e) => setPresencePenalty(e.target.value ? parseFloat(e.target.value) : undefined)}
                      min="-2"
                      max="2"
                    />
                  </div>
                </div>

                {/* Stop Sequences */}
                <div className="mt-4">
                  <label className="text-sm font-medium mb-2 block">Stop Sequences (optional)</label>
                  <Input
                    placeholder="Enter stop sequences separated by commas (e.g., \n, ###, STOP)"
                    value={stopSequences}
                    onChange={(e) => setStopSequences(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Comma-separated list of sequences where generation should stop
                  </p>
                </div>
              </div>

              {/* Process Button */}
              <Button 
                onClick={handleProcessBatch}
                disabled={!selectedModel || !csvFile || !selectedColumn || !saveResultsPath || isProcessing}
                className="w-full"
                size="lg"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isUploading ? 'Uploading to S3...' : 'Processing...'}
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Start Batch Processing
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Results Section */}
        {(isProcessing || currentTask || results.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Step 4: Processing Results
              </CardTitle>
              <CardDescription>
                Monitor progress and view your batch inference results
              </CardDescription>
            </CardHeader>
            <CardContent>
          {/* Processing Status */}
          {(isProcessing || (currentTask && currentTask.status !== 'completed')) && (
                <div className="space-y-6 mb-6">
                  {/* Main Status */}
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-accent" />
                    <div className="flex-1">
                      <p className="font-medium">
                        {currentTask ? 
                          `${currentTask.status === 'uploading' ? 'Uploading File to S3' : 
                            currentTask.status === 'starting' ? 'Starting Batch Processing' : 
                            currentTask.status === 'queued' ? 'Task Queued' :
                            currentTask.status === 'processing' ? 'Processing Batch' :
                            `Task Status: ${currentTask.status}`}` : 
                          isUploading ? 'Uploading File to S3...' : 'Processing batch inference...'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {currentTask ? 
                          currentTask.message || 'Task is running in the background' :
                          isUploading ? `Upload Progress: ${uploadProgress}%` : 'This may take a few moments depending on the number of inputs'
                        }
                      </p>
                      {currentTask?.task_id && currentTask.task_id !== '' && (
                        <p className="text-xs text-muted-foreground mt-1 font-mono">
                          Task ID: {currentTask.task_id}
                        </p>
                      )}
                    </div>
                    {uploadComplete && !currentTask && (
                      <CheckCircle className="h-5 w-5 text-accent" />
                    )}
                  </div>
                  
                  {/* Upload Progress Bar */}
                  {isUploading && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Upload Progress</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <Progress value={uploadProgress} className="w-full" />
                      {csvFile && (
                        <div className="text-xs text-muted-foreground">
                          File: {csvFile.name} ({(csvFile.size / 1024 / 1024).toFixed(2)} MB)
                        </div>
                      )}
                    </div>
                  )}

                  {/* Batch Processing Progress */}
                  {currentTask && currentTask.status === 'processing' && currentTask.progress && (
                    <div className="space-y-4">
                      {/* Progress Bar */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Processing Progress</span>
                          <span>
                            {currentTask.progress.lines_processed} / {totalLines || '?'} lines
                            {totalLines && (
                              <span className="text-muted-foreground ml-2">
                                ({Math.round((currentTask.progress.lines_processed / totalLines) * 100)}%)
                              </span>
                            )}
                          </span>
                        </div>
                        <Progress 
                          value={totalLines ? (currentTask.progress.lines_processed / totalLines) * 100 : 0} 
                          className="w-full" 
                        />
                      </div>

                      {/* Performance Metrics */}
                      {currentTask.performance && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-card/50 rounded-lg border border-border/50 backdrop-blur-sm">
                          <div className="text-center">
                            <div className="text-2xl font-bold text-accent">
                              {currentTask.performance.lines_per_second.toFixed(1)}
                            </div>
                            <div className="text-xs text-muted-foreground">Lines/sec</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-primary">
                              {Math.floor(currentTask.performance.elapsed_seconds / 60)}:{(currentTask.performance.elapsed_seconds % 60).toFixed(0).padStart(2, '0')}
                            </div>
                            <div className="text-xs text-muted-foreground">Elapsed</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-accent/80">
                              {currentTask.progress.batches_sent}
                            </div>
                            <div className="text-xs text-muted-foreground">Batches</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-primary/80">
                              {currentTask.progress.current_buffer_size}
                            </div>
                            <div className="text-xs text-muted-foreground">Buffer</div>
                          </div>
                        </div>
                      )}

                      {/* ETA Estimation */}
                      {currentTask.performance && totalLines && currentTask.performance.lines_per_second > 0 && (
                        <div className="text-center p-3 bg-accent/10 rounded-lg border border-accent/20 backdrop-blur-sm">
                          <div className="text-sm text-accent">
                            <strong>Estimated Time Remaining:</strong> {
                              Math.floor((totalLines - currentTask.progress.lines_processed) / currentTask.performance.lines_per_second / 60)
                            }m {
                              Math.floor(((totalLines - currentTask.progress.lines_processed) / currentTask.performance.lines_per_second) % 60)
                            }s
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Queued Status */}
                  {currentTask && currentTask.status === 'queued' && (
                    <div className="text-center p-4 bg-primary/10 rounded-lg border border-primary/20 backdrop-blur-sm">
                      <div className="text-sm text-primary">
                        <strong>Task Queued</strong> - Your batch processing task is waiting in the queue
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Results */}
              {results.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">
                      {currentTask?.status === 'completed' ? 'Processing completed' : `${results.length} results generated`}
                    </span>
                    <div className="flex gap-2">
                      {currentTask?.status === 'completed' && currentTask?.task_id && (
                        <Button onClick={handleDownloadFinalResults} variant="default" size="sm">
                          <Download className="h-4 w-4 mr-2" />
                          Download Final Results
                        </Button>
                      )}
                      <Button onClick={handleDownloadResults} variant="outline" size="sm">
                        <Download className="h-4 w-4 mr-2" />
                        Download Log
                      </Button>
                    </div>
                  </div>
                  
                  {currentTask?.status === 'completed' && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-accent/10 to-primary/10 rounded-lg border border-accent/20 shadow-sm backdrop-blur-sm">
                        <div className="flex-shrink-0">
                          <CheckCircle className="h-5 w-5 text-accent" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-accent">
                            Batch processing completed successfully!
                          </p>
                          <p className="text-xs text-accent/80 mt-1">
                            Your final results file has been generated and is ready for download.
                          </p>
                          {currentTask.task_id && (
                            <p className="text-xs text-accent/60 mt-1 font-mono">
                              Task ID: {currentTask.task_id}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Final Performance Summary */}
                      {currentTask.progress && currentTask.performance && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-card/50 rounded-lg border border-border/50 backdrop-blur-sm">
                          <div className="text-center">
                            <div className="text-xl font-bold text-accent">
                              {currentTask.progress.lines_processed}
                            </div>
                            <div className="text-xs text-muted-foreground">Total Lines</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xl font-bold text-primary">
                              {currentTask.performance.lines_per_second.toFixed(1)}
                            </div>
                            <div className="text-xs text-muted-foreground">Avg Lines/sec</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xl font-bold text-accent/80">
                              {Math.floor(currentTask.performance.elapsed_seconds / 60)}:{(currentTask.performance.elapsed_seconds % 60).toFixed(0).padStart(2, '0')}
                            </div>
                            <div className="text-xs text-muted-foreground">Total Time</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xl font-bold text-primary/80">
                              {currentTask.progress.batches_sent}
                            </div>
                            <div className="text-xs text-muted-foreground">Batches</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="bg-muted/50 rounded-lg p-4 max-h-[400px] overflow-y-auto">
                    <pre className="text-sm whitespace-pre-wrap">
                      {results.join('\n\n')}
                    </pre>
                  </div>
                </div>
              ) : !isProcessing && !currentTask && (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No results yet</p>
                  <p className="text-sm">Results will appear here once processing begins</p>
                </div>
              )}
              </CardContent>
            </Card>
          )}
      </div>
    </div>
  );
}
