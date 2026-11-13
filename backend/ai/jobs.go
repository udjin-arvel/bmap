package ai

import (
	"sync"

	"github.com/google/uuid"

	"bmap-api/graph"
)

const (
	StatusQueued    = "queued"
	StatusRunning   = "running"
	StatusCompleted = "completed"
	StatusError     = "error"
)

// JobOut — ответ GET /api/ai/jobs/{id} (AiJobOut).
type JobOut struct {
	JobID  string       `json:"jobId"`
	NodeID string       `json:"nodeId"`
	Status string       `json:"status"`
	Error  *string      `json:"error"`
	Nodes  []graph.Node `json:"nodes"`
	Edges  []graph.Edge `json:"edges"`
}

// JobStore — задачи в памяти процесса (как в Python-версии).
type JobStore struct {
	mu   sync.Mutex
	jobs map[string]*JobOut
}

func NewJobStore() *JobStore { return &JobStore{jobs: map[string]*JobOut{}} }

func (s *JobStore) Create(nodeID string) string {
	j := &JobOut{JobID: uuid.NewString(), NodeID: nodeID, Status: StatusQueued}
	s.mu.Lock()
	s.jobs[j.JobID] = j
	s.mu.Unlock()
	return j.JobID
}

// Get возвращает копию задачи.
func (s *JobStore) Get(id string) (JobOut, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok {
		return JobOut{}, false
	}
	return *j, true
}

func (s *JobStore) update(id string, fn func(*JobOut)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if j, ok := s.jobs[id]; ok {
		fn(j)
	}
}
