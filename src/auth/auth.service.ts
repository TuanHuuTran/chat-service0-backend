import { ConflictException, Injectable } from '@nestjs/common';
import { CreateAuthDto } from './dto/create-auth.dto';
import { UpdateAuthDto } from './dto/update-auth.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/auth.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async create(createAuthDto: CreateAuthDto) {
    // Kiểm tra email đã tồn tại chưa
    const existingUser = await this.userRepo.findOne({
      where: { email: createAuthDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    // Hash password trước khi lưu
    const hashedPassword = await bcrypt.hash(createAuthDto.password, 10);

    // Tạo user mới
    const newUser = this.userRepo.create({
      ...createAuthDto,
      password: hashedPassword,
    });

    console.log('newUser', newUser);

    // Lưu vào database
    const savedUser = await this.userRepo.save(newUser);

    // Xóa password trước khi trả về (để bảo mật)
    const { password, ...result } = savedUser;
    return result;
  }

  async findAll() {
    return await this.userRepo.find();
  }

  findOne(id: number) {
    return `This action returns a #${id} auth`;
  }

  update(id: number, updateAuthDto: UpdateAuthDto) {
    return `This action updates a #${id} auth`;
  }

  remove(id: number) {
    return `This action removes a #${id} auth`;
  }
}
