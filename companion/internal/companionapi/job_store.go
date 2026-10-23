package companionapi

import (
	"fmt"
	"sync"
	"time"
)

// jobStore holds the async jobs of one kind (firmware update, theme install),
// keyed by id. Readers always get copies.
type jobStore[T any] struct {
	mu        sync.Mutex
	jobs      map[string]*T
	next      uint64
	clone     func(*T) T
	startedAt func(*T) time.Time
}

func newJobStore[T any](clone func(*T) T, startedAt func(*T) time.Time) *jobStore[T] {
	return &jobStore[T]{jobs: make(map[string]*T), clone: clone, startedAt: startedAt}
}

// create stores the job build returns for a fresh "<prefix>-<nanos>-<n>" id.
func (j *jobStore[T]) create(prefix string, build func(id string) *T) T {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.next++
	id := fmt.Sprintf("%s-%d-%d", prefix, time.Now().UnixNano(), j.next)
	job := build(id)
	j.jobs[id] = job
	return j.clone(job)
}

func (j *jobStore[T]) update(id string, update func(*T)) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if job := j.jobs[id]; job != nil {
		update(job)
	}
}

func (j *jobStore[T]) snapshot(id string) (T, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	job := j.jobs[id]
	if job == nil {
		var zero T
		return zero, false
	}
	return j.clone(job), true
}

// find returns the first job matching, in no particular order.
func (j *jobStore[T]) find(match func(*T) bool) (T, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, job := range j.jobs {
		if job != nil && match(job) {
			return j.clone(job), true
		}
	}
	var zero T
	return zero, false
}

func (j *jobStore[T]) latest() (T, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	var latest *T
	for _, job := range j.jobs {
		if job != nil && (latest == nil || j.startedAt(job).After(j.startedAt(latest))) {
			latest = job
		}
	}
	if latest == nil {
		var zero T
		return zero, false
	}
	return j.clone(latest), true
}
