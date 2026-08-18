import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { AlertTriangle, TrendingUp, CheckCircle2, AlertCircle } from 'lucide-react';
import * as api from '@/services/api';

export function TriageDashboard() {
  const [dashboard, setDashboard] = useState<api.TriageDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.getTriageDashboard();
      setDashboard(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load triage dashboard');
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500" />
      </div>
    );
  }

  // Prepare data for workflow chart
  const workflowData = Object.entries(dashboard.casesByWorkflowStep).map(([step, count]) => ({
    name: step,
    cases: count,
  }));

  // Prepare data for priority pie chart
  const priorityData = [
    { name: 'Critical', value: dashboard.criticalCases, color: '#dc2626' },
    { name: 'High', value: dashboard.highPriorityCases, color: '#ea580c' },
    { name: 'Normal', value: dashboard.totalCases - dashboard.criticalCases - dashboard.highPriorityCases, color: '#eab308' },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Triage Dashboard</h1>
        <p className="text-gray-600">Organization-wide case metrics and workflow status</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-700">Total Cases</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.totalCases}</div>
            <p className="text-xs text-gray-600">In organization</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center space-x-1 text-sm font-medium text-orange-700">
              <AlertTriangle className="h-4 w-4" />
              <span>Critical</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{dashboard.criticalCases}</div>
            <p className="text-xs text-gray-600">Urgent medical events</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center space-x-1 text-sm font-medium text-orange-700">
              <AlertCircle className="h-4 w-4" />
              <span>High Priority</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">{dashboard.highPriorityCases}</div>
            <p className="text-xs text-gray-600">Requiring attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center space-x-1 text-sm font-medium text-blue-700">
              <TrendingUp className="h-4 w-4" />
              <span>Avg Score</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{dashboard.averageTriageScore.toFixed(0)}</div>
            <p className="text-xs text-gray-600">Across all cases</p>
          </CardContent>
        </Card>
      </div>

      {/* Serious Cases Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Serious Cases</CardTitle>
          <CardDescription>Cases marked as serious or non-serious</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold">{dashboard.seriousCases}</p>
              <p className="text-sm text-gray-600">of {dashboard.totalCases} total</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-red-600">{dashboard.seriousCasePercentage.toFixed(1)}%</p>
              <p className="text-sm text-gray-600">are serious</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Workflow Step Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cases by Workflow Step</CardTitle>
            <CardDescription>Distribution across workflow stages</CardDescription>
          </CardHeader>
          <CardContent>
            {workflowData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={workflowData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} interval={0} tick={{ fontSize: 12 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="cases" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-gray-600">No data available</p>
            )}
          </CardContent>
        </Card>

        {/* Priority Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Priority Distribution</CardTitle>
            <CardDescription>Cases by priority level</CardDescription>
          </CardHeader>
          <CardContent>
            {priorityData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={priorityData} cx="50%" cy="50%" labelLine={false} label={(entry) => `${entry.name}: ${entry.value}`} outerRadius={80} fill="#8884d8" dataKey="value">
                    {priorityData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-gray-600">No data available</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Performance Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performance Metrics</CardTitle>
          <CardDescription>Workflow completion and efficiency</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">Case Completion Rate</span>
                <span className="font-bold">{dashboard.metrics.completionRate.toFixed(1)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-green-500 transition-all"
                  style={{ width: `${dashboard.metrics.completionRate}%` }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Alert */}
      {dashboard.criticalCases > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Urgent Cases Require Attention</AlertTitle>
          <AlertDescription>
            {dashboard.criticalCases} case{dashboard.criticalCases > 1 ? 's' : ''} with urgent medical events detected. Review these cases immediately.
          </AlertDescription>
        </Alert>
      )}

      {dashboard.highPriorityCases > 0 && (
        <Alert variant="default" className="border-orange-200 bg-orange-50">
          <AlertCircle className="h-4 w-4 text-orange-600" />
          <AlertTitle className="text-orange-900">High Priority Cases</AlertTitle>
          <AlertDescription className="text-orange-800">
            {dashboard.highPriorityCases} case{dashboard.highPriorityCases > 1 ? 's' : ''} flagged as high priority. Consider prioritizing these in case assignments.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default TriageDashboard;
