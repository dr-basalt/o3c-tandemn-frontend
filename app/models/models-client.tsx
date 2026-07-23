'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Copy, Brain, Code, MessageSquare, ExternalLink, Zap } from 'lucide-react';
import { O3CModel } from '@/config/models';

interface ModelsClientProps {
  initialModels: O3CModel[];
}

export default function ModelsClient({ initialModels }: ModelsClientProps) {
  const [models] = useState<O3CModel[]>(initialModels);
  const [selectedModel, setSelectedModel] = useState<O3CModel | null>(
    initialModels.length > 0 ? initialModels[0] : null
  );

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Simple feedback - in production you'd use a toast
    const button = document.activeElement as HTMLButtonElement;
    if (button) {
      const originalText = button.textContent;
      button.textContent = 'Copied!';
      setTimeout(() => {
        if (button.textContent === 'Copied!') {
          button.textContent = originalText;
        }
      }, 2000);
    }
  };

  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getApiDomain = () => {
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return 'https://o3c-frontend.vercel.app';
  };

  const generateCurlExample = (model: O3CModel) => {
    const domain = getApiDomain();
    
    const body = {
      model: model.id,
      messages: [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello! Can you explain quantum computing?' }
      ],
      stream: true,
      temperature: 0.7,
      max_completion_tokens: 2000
    };

    const headers = [
      'Authorization: Bearer YOUR_API_KEY',
      'Accept: text/event-stream',
      'Cache-Control: no-cache', 
      'Content-Type: application/json'
    ];
    
    const headerString = headers.map(h => `--header '${h}'`).join(' \\\n');
    
    return `curl --location '${domain}/api/v1/chat/completions' \\
${headerString} \\
--data '${JSON.stringify(body, null, 2)}'`;
  };

  const generatePythonExample = (model: O3CModel) => {
    const domain = getApiDomain();
    return `import requests

url = "${domain}/api/v1/chat/completions"
headers = {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
}
data = {
    "model": "${model.id}",
    "messages": [
        {"role": "user", "content": "Hello! Can you explain quantum computing?"}
    ]
}

response = requests.post(url, headers=headers, json=data)
print(response.json())`;
  };

  const generateNodeExample = (model: O3CModel) => {
    const domain = getApiDomain();
    return `const fetch = require('node-fetch');

const response = await fetch('${domain}/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: '${model.id}',
    messages: [
      { role: 'user', content: 'Hello! Can you explain quantum computing?' }
    ]
  })
});

const data = await response.json();
console.log(data);`;
  };

  return (
    <div className="container max-w-7xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Models</h1>
        <p className="text-muted-foreground">
          Choose from our available models and get started with API integration
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Models List */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Available Models
              </CardTitle>
              <CardDescription>
                Select a model to view details and integration examples
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {models.map((model) => (
                <div
                  key={model.id}
                  className={`p-4 border rounded-lg cursor-pointer transition-all hover:shadow-md ${
                    selectedModel?.id === model.id
                      ? 'border-[#00f0ff] bg-[#00f0ff]/10 shadow-[0_0_15px_rgba(0,240,255,0.3)]'
                      : 'border-border hover:border-[#00f0ff]/50'
                  }`}
                  onClick={() => setSelectedModel(model)}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">{model.name}</h3>
                      <Badge variant="secondary" className="text-xs">
                        {model.provider}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {model.description}
                    </p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {formatNumber(model.context_length)} context
                      </span>
                      <span className="text-muted-foreground">
                        {formatPrice(model.input_price_per_1m)}/1M tokens
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {model.capabilities.slice(0, 3).map((capability) => (
                        <Badge key={capability} variant="outline" className="text-xs">
                          {capability}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Model Details and API Integration */}
        <div className="lg:col-span-2">
          {selectedModel ? (
            <div className="space-y-6">
              {/* Model Details */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Zap className="h-5 w-5" />
                        {selectedModel.name}
                      </CardTitle>
                      <CardDescription>{selectedModel.description}</CardDescription>
                    </div>
                    <Badge variant="secondary">{selectedModel.provider}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Context Length</p>
                      <p className="text-2xl font-bold text-[#00f0ff] drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]">
                        {formatNumber(selectedModel.context_length)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Input Price</p>
                      <p className="text-2xl font-bold text-[#00f0ff] drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]">
                        {formatPrice(selectedModel.input_price_per_1m)}
                      </p>
                      <p className="text-xs text-muted-foreground">per 1M tokens</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Output Price</p>
                      <p className="text-2xl font-bold text-[#00f0ff] drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]">
                        {formatPrice(selectedModel.output_price_per_1m)}
                      </p>
                      <p className="text-xs text-muted-foreground">per 1M tokens</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Max Tokens</p>
                      <p className="text-2xl font-bold text-[#00f0ff] drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]">
                        {formatNumber(selectedModel.max_tokens)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium">Capabilities</p>
                      <Link href={`/chat?model=${selectedModel.id}`}>
                        <Button 
                          size="sm" 
                          className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25 ring-2 ring-primary/20 hover:ring-primary/30 transition-all duration-300"
                        >
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Try in Playground
                        </Button>
                      </Link>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedModel.capabilities.map((capability) => (
                        <Badge key={capability} variant="outline">
                          {capability}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Code Examples */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Code className="h-5 w-5" />
                    Code Examples
                  </CardTitle>
                  <CardDescription>
                    Direct API endpoints for {selectedModel.name}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div>
                    <Tabs defaultValue="curl" className="space-y-4">
                      <TabsList>
                        <TabsTrigger value="curl">cURL</TabsTrigger>
                        <TabsTrigger value="python">Python</TabsTrigger>
                        <TabsTrigger value="node">Node.js</TabsTrigger>
                      </TabsList>

                      <TabsContent value="curl" className="space-y-2">
                        <div className="relative">
                          <pre className="bg-muted/50 p-4 rounded-lg text-sm overflow-x-auto border">
                            <code className="text-foreground font-mono">{generateCurlExample(selectedModel)}</code>
                          </pre>
                          <Button
                            size="sm"
                            variant="outline"
                            className="absolute top-2 right-2"
                            onClick={() => copyToClipboard(generateCurlExample(selectedModel))}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </TabsContent>

                      <TabsContent value="python" className="space-y-2">
                        <div className="relative">
                          <pre className="bg-muted/50 p-4 rounded-lg text-sm overflow-x-auto border">
                            <code className="text-foreground font-mono">{generatePythonExample(selectedModel)}</code>
                          </pre>
                          <Button
                            size="sm"
                            variant="outline"
                            className="absolute top-2 right-2"
                            onClick={() => copyToClipboard(generatePythonExample(selectedModel))}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </TabsContent>

                      <TabsContent value="node" className="space-y-2">
                        <div className="relative">
                          <pre className="bg-muted/50 p-4 rounded-lg text-sm overflow-x-auto border">
                            <code className="text-foreground font-mono">{generateNodeExample(selectedModel)}</code>
                          </pre>
                          <Button
                            size="sm"
                            variant="outline"
                            className="absolute top-2 right-2"
                            onClick={() => copyToClipboard(generateNodeExample(selectedModel))}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </div>

                  {/* Documentation Links */}
                  <div className="mt-6 pt-6 border-t">
                    <h3 className="text-lg font-semibold mb-3">Documentation</h3>
                    <div className="grid grid-cols-1 gap-3">
                      <Link href="/credits" className="flex items-center gap-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                        <Zap className="h-4 w-4" />
                        <div>
                          <p className="font-medium text-sm">Credits & Billing</p>
                          <p className="text-xs text-muted-foreground">Manage your usage and billing</p>
                        </div>
                        <ExternalLink className="h-4 w-4 ml-auto" />
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center h-64">
                <p className="text-muted-foreground">Select a model to view details</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

