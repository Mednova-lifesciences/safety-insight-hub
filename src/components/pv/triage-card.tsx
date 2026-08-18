import { useState, useEffect } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, TrendingUp, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import * as api from '@/services/api';

export interface TriageCardProps {
  caseId: string;
  caseNumber: string;
}

export function TriageCard({ caseId, caseNumber }: TriageCardProps) {
  const [triageScore, setTriageScore] = useState<api.TriageScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    calculateScore();
  }, [caseId]);

  const calculateScore = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.calculateTriageScore(caseId);
      setTriageScore(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate triage score');
    } finally {
      setLoading(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'CRITICAL':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'HIGH':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      default:
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'CRITICAL':
        return <AlertTriangle className="h-5 w-5" />;
      case 'HIGH':
        return <AlertCircle className="h-5 w-5" />;
      default:
        return <Clock className="h-5 w-5" />;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 75) return 'text-red-600';
    if (score >= 50) return 'text-orange-600';
    return 'text-yellow-600';
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

  if (!triageScore) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Triage Assessment</h3>
          <p className="text-sm text-gray-600">Case {caseNumber}</p>
        </div>
        <button
          onClick={calculateScore}
          disabled={loading}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          {loading ? 'Recalculating...' : 'Recalculate'}
        </button>
      </div>

      {/* Priority Badge and Score */}
      <div className="grid grid-cols-2 gap-4">
        <div className={`rounded-lg border-2 p-4 ${getPriorityColor(triageScore.priority)}`}>
          <div className="flex items-center space-x-2">
            {getPriorityIcon(triageScore.priority)}
            <div>
              <p className="text-xs font-semibold">Priority Level</p>
              <p className="text-lg font-bold">{triageScore.priority}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4">
          <div className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-xs font-semibold text-gray-700">Triage Score</p>
              <p className={`text-2xl font-bold ${getScoreColor(triageScore.triageScore)}`}>
                {triageScore.triageScore.toFixed(0)}/100
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Score Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">Overall Score</span>
          <span className="text-gray-600">{triageScore.triageScore.toFixed(1)}</span>
        </div>
        <Progress value={triageScore.triageScore} className="h-2" />
      </div>

      {/* Recommended Next Step */}
      <Alert className="border-blue-200 bg-blue-50">
        <CheckCircle2 className="h-4 w-4 text-blue-600" />
        <AlertTitle className="text-blue-900">Recommended Next Step</AlertTitle>
        <AlertDescription className="text-blue-800">
          {triageScore.recommendedNextStep}
        </AlertDescription>
      </Alert>

      {/* Rationale */}
      <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
        <span className="font-semibold">Assessment: </span>
        {triageScore.rationale}
      </p>

      {/* Scoring Factors */}
      <div className="space-y-2">
        <h4 className="font-semibold text-gray-900">Scoring Factors</h4>
        <div className="space-y-2">
          {triageScore.factors.map((factor, idx) => (
            <div key={idx} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
              <div>
                <p className="font-medium text-gray-900">{factor.name}</p>
                <p className="text-xs text-gray-600">{factor.description}</p>
              </div>
              <Badge variant={factor.points > 15 ? 'default' : 'secondary'}>
                +{factor.points}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default TriageCard;
