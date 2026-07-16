//go:build !darwin && !linux

package writerlock

type Lock struct{}

func Acquire() (*Lock, error) {
	return &Lock{}, nil
}

func AcquireAt(string) (*Lock, error) {
	return &Lock{}, nil
}

func (l *Lock) Release() {}
