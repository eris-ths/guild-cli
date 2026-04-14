import { MemberName } from './MemberName.js';
import { MemberCategory, parseMemberCategory } from './MemberCategory.js';
import { DomainError } from '../shared/DomainError.js';

export interface MemberProps {
  name: MemberName;
  category: MemberCategory;
  displayName?: string;
  active: boolean;
}

const MAX_DISPLAY_NAME_LEN = 64;

export class Member {
  private constructor(private readonly props: MemberProps) {}

  static create(input: {
    name: string;
    category: string;
    displayName?: string;
    active?: boolean;
  }): Member {
    const name = MemberName.of(input.name);
    const category = parseMemberCategory(input.category);
    const displayName = input.displayName?.trim();
    if (displayName !== undefined && displayName.length > MAX_DISPLAY_NAME_LEN) {
      throw new DomainError(
        `displayName too long (max ${MAX_DISPLAY_NAME_LEN})`,
        'displayName',
      );
    }
    const props: MemberProps = {
      name,
      category,
      active: input.active ?? true,
    };
    if (displayName !== undefined) {
      props.displayName = displayName;
    }
    return new Member(props);
  }

  get name(): MemberName {
    return this.props.name;
  }
  get category(): MemberCategory {
    return this.props.category;
  }
  get displayName(): string | undefined {
    return this.props.displayName;
  }
  get active(): boolean {
    return this.props.active;
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      name: this.props.name.value,
      category: this.props.category,
      active: this.props.active,
    };
    if (this.props.displayName !== undefined) {
      out['displayName'] = this.props.displayName;
    }
    return out;
  }
}
