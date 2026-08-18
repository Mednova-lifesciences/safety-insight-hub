import { useState, useEffect } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import * as api from '@/services/api';

export interface ConsistencyCheckProps {
  caseId: string;
  onCheckComplete?: (checks: api.ConsistencyCheckResult[]) => void;
}

export function ConsistencyCheckPanel({ caseId, onCheckComplete }: ConsistencyCheckProps) {
  const [checks, setChecks] = useState<api.ConsistencyCheckResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoChecked, setAutoChecked] = useState(false);

  // Auto-run checks when component mounts
  useEffect(() => {
    if (!autoChecked) {
      runChecks();
      setAutoChecked(true);
    }
  }, [caseId, autoChecked]);

  const runChecks = async () => {
    try {
      setLoading(true);
      setError(null);
      const results = await api.runConsistencyCheck(caseId);
      setChecks(results);
      onCheckComplete?.(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run consistency checks');
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async (checkId: string) => {
    try {
      await api.acknowledgeCheck(caseId, checkId);
      setChecks((prev) =>
        prev.map((c) => (c.id === checkId ? { ...c, status: 'ACKNOWLEDGED' } : c)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to acknowledge check');
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'ERROR':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      case 'WARNING':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'INFO':
        return <Info className="h-5 w-5 text-blue-500" />;
      default:
        return <Info className="h-5 w-5" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'ERROR':
        return 'destructive';
      case 'WARNING':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const errorChecks = checks.filter((c) => c.severity === 'ERROR');
  const warningChecks = checks.filter((c) => c.severity === 'WARNING');
  const infoChecks = checks.filter((c) => c.severity === 'INFO');
  const acknowledgedChecks = checks.filter((c) => c.status === 'ACKNOWLEDGED');

  return (
    <div className="space-y-6">
      {/* Header with statistics */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Quality Assurance Checks</h3>
          <p className="text-sm text-gray-500">
            {checks.length} {checks.length === 1 ? 'check' : 'checks'} performed
          </p>
        </div>
        <Button onClick={runChecks} disabled={loading} size="sm" variant="outline">
          {loading ? 'Running...' : 'Re-run Checks'}
        </Button>
      </div>

      {/* Error message */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Empty state */}
      {checks.length === 0 && !loading && !error && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>No issues found</AlertTitle>
          <AlertDescription>This case passes all quality checks.</AlertDescription>
        </Alert>
      )}

      {/* Summary statistics */}
      {checks.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border p-3">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <div>
                <p className="text-xs text-gray-500">Errors</p>
                <p className="text-2xl font-bold">{errorChecks.length}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <div>
                <p className="text-xs text-gray-500">Warnings</p>
                <p className="text-2xl font-bold">{warningChecks.length}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="flex items-center space-x-2">
              <Info className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-xs text-gray-500">Informational</p>
                <p className="text-2xl font-bold">{infoChecks.length}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Checks by severity */}
      <div className="space-y-4">
        {/* Error checks */}
        {errorChecks.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-red-600">Critical Issues ({errorChecks.length})</h4>
            {errorChecks.map((check) => (
              <div
                key={check.id}
                className={`rounded-lg border-l-4 border-red-500 bg-red-50 p-4 ${
                  check.status === 'ACKNOWLEDGED' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    <AlertCircle className="mt-1 h-5 w-5 flex-shrink-0 text-red-500" />
                    <div>
                      <h5 className="font-semibold">{check.checkType.replace(/_/g, ' ')}</h5>
                      <p className="text-sm text-gray-700">{check.message}</p>
                      {check.suggestedResolution && (
                        <p className="mt-2 text-xs text-gray-600">
                          <span className="font-semibold">Resolution:</span> {check.suggestedResolution}
                        </p>
                      )}
                    </div>
                  </div>
                  {check.status !== 'ACKNOWLEDGED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleAcknowledge(check.id)}
                      className="ml-2"
                    >
                      Acknowledge
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Warning checks */}
        {warningChecks.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-yellow-600">Warnings ({warningChecks.length})</h4>
            {warningChecks.map((check) => (
              <div
                key={check.id}
                className={`rounded-lg border-l-4 border-yellow-500 bg-yellow-50 p-4 ${
                  check.status === 'ACKNOWLEDGED' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="mt-1 h-5 w-5 flex-shrink-0 text-yellow-500" />
                    <div>
                      <h5 className="font-semibold">{check.checkType.replace(/_/g, ' ')}</h5>
                      <p className="text-sm text-gray-700">{check.message}</p>
                      {check.suggestedResolution && (
                        <p className="mt-2 text-xs text-gray-600">
                          <span className="font-semibold">Suggestion:</span> {check.suggestedResolution}
                        </p>
                      )}
                    </div>
                  </div>
                  {check.status !== 'ACKNOWLEDGED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleAcknowledge(check.id)}
                      className="ml-2"
                    >
                      Acknowledge
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info checks */}
        {infoChecks.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-blue-600">Information ({infoChecks.length})</h4>
            {infoChecks.map((check) => (
              <div
                key={check.id}
                className={`rounded-lg border-l-4 border-blue-500 bg-blue-50 p-4 ${
                  check.status === 'ACKNOWLEDGED' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    <Info className="mt-1 h-5 w-5 flex-shrink-0 text-blue-500" />
                    <div>
                      <h5 className="font-semibold">{check.checkType.replace(/_/g, ' ')}</h5>
                      <p className="text-sm text-gray-700">{check.message}</p>
                      {check.suggestedResolution && (
                        <p className="mt-2 text-xs text-gray-600">
                          <span className="font-semibold">Note:</span> {check.suggestedResolution}
                        </p>
                      )}
                    </div>
                  </div>
                  {check.status !== 'ACKNOWLEDGED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleAcknowledge(check.id)}
                      className="ml-2"
                    >
                      Acknowledge
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Acknowledged checks summary */}
      {acknowledgedChecks.length > 0 && (
        <Alert variant="default" className="mt-4">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Acknowledged Issues</AlertTitle>
          <AlertDescription>
            {acknowledgedChecks.length} {acknowledgedChecks.length === 1 ? 'issue has' : 'issues have'} been
            acknowledged by the user
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default ConsistencyCheckPanel;
