import { useState, useEffect } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Copy } from 'lucide-react';
import * as api from '@/services/api';

export interface DuplicateDetectionProps {
  caseId: string;
  caseNumber: string;
  onDuplicateFound?: (duplicates: api.DuplicateCandidate[]) => void;
}

export function DuplicateDetectionPanel({
  caseId,
  caseNumber,
  onDuplicateFound,
}: DuplicateDetectionProps) {
  const [duplicates, setDuplicates] = useState<api.DuplicateCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoChecked, setAutoChecked] = useState(false);

  // Auto-run duplicate check when component mounts
  useEffect(() => {
    if (!autoChecked) {
      runDuplicateCheck();
      setAutoChecked(true);
    }
  }, [caseId, autoChecked]);

  const runDuplicateCheck = async () => {
    try {
      setLoading(true);
      setError(null);
      const results = await api.checkForDuplicates(caseId);
      setDuplicates(results);
      onDuplicateFound?.(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check for duplicates');
    } finally {
      setLoading(false);
    }
  };

  const handleResolveDuplicate = async (
    matchId: string,
    action: 'REVIEWED' | 'MERGED' | 'KEEP_SEPARATE',
  ) => {
    try {
      await api.resolveDuplicateMatch(matchId, action);
      setDuplicates((prev) =>
        prev.map((d) => (d.id === matchId ? { ...d, status: 'REVIEWED' } : d)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve duplicate');
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 85) return 'bg-red-100 text-red-800';
    if (confidence >= 75) return 'bg-orange-100 text-orange-800';
    return 'bg-yellow-100 text-yellow-800';
  };

  const getConfidenceBadgeVariant = (confidence: number) => {
    if (confidence >= 85) return 'destructive';
    if (confidence >= 75) return 'secondary';
    return 'outline';
  };

  const unresolvedDuplicates = duplicates.filter((d) => d.status === 'OPEN');
  const resolvedDuplicates = duplicates.filter((d) => d.status !== 'OPEN');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Duplicate Detection</h3>
          <p className="text-sm text-gray-500">
            Checking case {caseNumber} against {duplicates.length} other cases
          </p>
        </div>
        <Button onClick={runDuplicateCheck} disabled={loading} size="sm" variant="outline">
          {loading ? 'Scanning...' : 'Rescan'}
        </Button>
      </div>

      {/* Error message */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* No duplicates found */}
      {duplicates.length === 0 && !loading && !error && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>No Duplicates Detected</AlertTitle>
          <AlertDescription>
            This case does not closely match any other cases in your organization.
          </AlertDescription>
        </Alert>
      )}

      {/* Unresolved duplicates */}
      {unresolvedDuplicates.length > 0 && (
        <div className="space-y-3">
          <div className="mb-3 flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <h4 className="font-semibold text-red-600">
              Potential Duplicates ({unresolvedDuplicates.length})
            </h4>
          </div>

          <div className="space-y-3">
            {unresolvedDuplicates.map((duplicate) => (
              <div
                key={duplicate.id}
                className="rounded-lg border border-orange-200 bg-orange-50 p-4"
              >
                {/* Header with case number and confidence */}
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div>
                      <p className="font-semibold text-gray-900">{duplicate.caseNumber}</p>
                      <p className="text-xs text-gray-600">
                        Created {new Date(duplicate.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <Badge className={getConfidenceBadgeVariant(duplicate.confidence)}>
                    {duplicate.confidence.toFixed(0)}% Match
                  </Badge>
                </div>

                {/* Match details */}
                <div className="mb-4 space-y-2 rounded bg-white p-3">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="font-semibold text-gray-700">Product</p>
                      <p className="text-gray-600">
                        {duplicate.matchedFields.product.toFixed(0)}% match
                      </p>
                      <p className="mt-1 break-words text-gray-500">
                        {duplicate.evidence.product}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-700">Patient</p>
                      <p className="text-gray-600">
                        {duplicate.matchedFields.patient.toFixed(0)}% match
                        {duplicate.matchedFields.dobMatch && ' (DOB match)'}
                      </p>
                      <p className="mt-1 break-words text-gray-500">
                        {duplicate.evidence.patient}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-700">Reaction</p>
                      <p className="text-gray-600">
                        {duplicate.matchedFields.reaction.toFixed(0)}% match
                      </p>
                      <p className="mt-1 break-words text-gray-500">
                        {duplicate.evidence.reaction}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex space-x-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleResolveDuplicate(duplicate.id, 'KEEP_SEPARATE')}
                  >
                    Keep Separate
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleResolveDuplicate(duplicate.id, 'MERGED')}
                  >
                    Merge Cases
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.location.href = `/cases/${duplicate.caseId}`}
                  >
                    <Copy className="mr-1 h-4 w-4" />
                    View Case
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resolved duplicates summary */}
      {resolvedDuplicates.length > 0 && (
        <Alert variant="default">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Reviewed Duplicates</AlertTitle>
          <AlertDescription>
            {resolvedDuplicates.length} duplicate{resolvedDuplicates.length === 1 ? '' : 's'} have been reviewed
          </AlertDescription>
        </Alert>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500" />
          <span className="ml-2 text-gray-600">Scanning for duplicates...</span>
        </div>
      )}
    </div>
  );
}

export default DuplicateDetectionPanel;
